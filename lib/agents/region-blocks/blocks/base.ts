import { callLLM } from "@/lib/agents/llm-client";
import {
  retrieveOpenSources,
  formatEvidenceForPrompt,
} from "@/lib/integrations/web-retrieval";
import type { Source } from "@/lib/schemas/structured-output";
import type { BlockDeps } from "../types";
import type { BlockKind } from "../types";
import { tryParseJson } from "@/lib/utils/json";
import { logBlockEvent } from "../logger";
import { cacheKeyForRegion, getOrRefreshBlockEvidence, readRegionCache } from "../region-cache";

export async function prepareBlockSources(
  deps: BlockDeps,
  queries: string[],
  options: { broad?: boolean; kind?: BlockKind; skipCache?: boolean; maxFullTextChars?: number; limit?: number } = {},
): Promise<{ webEvidence: string; sources: Source[] }> {
  if (deps.webEvidence) {
    return { webEvidence: deps.webEvidence, sources: deps.collectedSources || [] };
  }

  const startedAt = Date.now();
  const regionId = cacheKeyForRegion(deps.session.regionId, deps.region);

  if (options.kind && !options.broad && !options.skipCache) {
    try {
      const cached = await getOrRefreshBlockEvidence(regionId, deps.region, options.kind);
      if (cached) {
        let evidenceText = cached.evidenceText;
        let sources = cached.sources;

        if (options.kind === "summary") {
          const regionCache = await readRegionCache(regionId);
          const budgetCache = regionCache?.blocks.budget;
          if (budgetCache?.evidence?.length) {
            const budgetEvidence = formatEvidenceForPrompt(budgetCache.evidence, 2000);
            evidenceText = `${evidenceText}\n\n--- Дополнительно: бюджетные источники ---\n${budgetEvidence}`;
            sources = [...sources, ...budgetCache.sources];
          }
        }

        console.log(`[blocks][sources] cache hit kind=${options.kind} age=${Math.round((Date.now() - new Date(cached.fetchedAt).getTime()) / 1000)}s`);
        await logBlockEvent({
          sessionId: deps.session.id,
          runId: deps.runId,
          scope: "blocks.sources",
          message: "cache_hit",
          data: { kind: options.kind, elapsedMs: Date.now() - startedAt },
        });
        return { webEvidence: evidenceText, sources };
      }
    } catch (err) {
      console.warn(`[blocks][sources] cache miss, falling back to live search: ${err instanceof Error ? err.message : err}`);
    }
  }

  await logBlockEvent({
    sessionId: deps.session.id,
    runId: deps.runId,
    scope: "blocks.sources",
    message: "start",
    data: { region: deps.region, queries },
  });

  const evidence = await retrieveOpenSources({
    region: deps.region,
    focusTopic: queries.slice(0, 2).join(" "),
    queries: options.broad ? undefined : queries,
    limit: options.limit ?? 4,
  });
  console.log(
    `[blocks][sources] done in ${Date.now() - startedAt}ms returned=${evidence.length}`,
  );
  await logBlockEvent({
    sessionId: deps.session.id,
    runId: deps.runId,
    scope: "blocks.sources",
    message: "done",
    data: { elapsedMs: Date.now() - startedAt, returned: evidence.length },
  });

  const webEvidence = formatEvidenceForPrompt(evidence, options.maxFullTextChars ?? 4000);

  const sources: Source[] = evidence
    .slice(0, 6)
    .filter((e) => e.contentFetched || /^https?:\/\//.test(e.url))
    .map((e) => ({
      title: e.title,
      url: e.url,
      excerpt: e.snippet.slice(0, 220),
      isVerified: e.contentFetched || false,
    }));

  return { webEvidence, sources };
}

export async function callBlockLLM(
  systemPrompt: string,
  userMessage: string,
  agentInstructions = "",
  logContext?: { sessionId?: string; runId?: string; label?: string },
): Promise<string> {
  const instructions = agentInstructions.trim()
    ? `\n\nАктуальные инструкции агента из playbook и отзывов:\n${agentInstructions.trim()}`
    : "";
  const startedAt = Date.now();
  console.log(
    `[blocks][llm] start promptChars=${systemPrompt.length + userMessage.length} instructions=${agentInstructions ? "yes" : "no"}`,
  );
  await logBlockEvent({
    sessionId: logContext?.sessionId,
    runId: logContext?.runId,
    scope: "blocks.llm",
    message: "start",
    data: {
      label: logContext?.label,
      promptChars: systemPrompt.length + userMessage.length,
      instructions: Boolean(agentInstructions),
    },
  });
  const raw = await callLLM({
    messages: [
      { role: "system", content: `${systemPrompt}${instructions}` },
      { role: "user", content: userMessage },
    ],
    temperature: 0.2,
    maxTokens: 1500,
    responseFormat: "json_object",
  });
  console.log(`[blocks][llm] done in ${Date.now() - startedAt}ms chars=${raw.length}`);
  await logBlockEvent({
    sessionId: logContext?.sessionId,
    runId: logContext?.runId,
    scope: "blocks.llm",
    message: "done",
    data: { label: logContext?.label, elapsedMs: Date.now() - startedAt, chars: raw.length },
  });
  return raw;
}

export function buildContextPreamble(deps: BlockDeps): string {
  return [
    deps.regionContext
      ? `Контекст из карточки региона и сохранённых данных:\n${deps.regionContext}`
      : "",
    deps.sberProjectsContext
      ? `\nРелевантные реальные проекты Сбера для оценки конкурентной позиции:\n${deps.sberProjectsContext}`
      : "",
  ].filter(Boolean).join("\n\n");
}

export function parseBlockJson(raw: string): unknown {
  return tryParseJson(raw);
}

export function assertMinItems(
  value: unknown,
  min: number,
  message: string,
): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length < min) {
    throw new Error(message);
  }
}

export function hasUsefulText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function normalizeHypotheses(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim()) {
      result.push(item.trim());
      continue;
    }
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      const text = [record.statement, record.title, record.question, record.reason]
        .find((part): part is string => typeof part === "string" && part.trim().length > 0);
      if (text) result.push(text.trim());
    }
  }
  return Array.from(new Set(result)).slice(0, 8);
}

export async function refineByAgentInstructions<T>(
  value: T,
  label: string,
  systemPrompt: string,
  userMessage: string,
  agentInstructions = "",
): Promise<T> {
  if (!agentInstructions.trim()) return value;
  if (process.env.BLOCK_REFINEMENT_MODE !== "always") return value;

  const startedAt = Date.now();
  console.log(`[blocks][refine] start label="${label}" mode=always`);
  await logBlockEvent({
    scope: "blocks.refine",
    message: "start",
    data: { label },
  });
  const raw = await callLLM({
    messages: [
      {
        role: "system",
        content: `Ты — редактор управленческих материалов. Примени актуальные инструкции агента к пользовательскому тексту в JSON:
- сохрани структуру, ключи и факты;
- не добавляй новые факты;
- исправляй только стиль, ясность, деловую точность и формулировки;
- если инструкция не относится к разделу, не меняй текст;
- верни только исправленный JSON.

Актуальные инструкции агента:
${agentInstructions.trim()}`,
      },
      {
        role: "user",
        content: [
          `Раздел: ${label}`,
          `Исходное задание:\n${systemPrompt}`,
          `Контекст:\n${userMessage}`,
          "JSON для редакторской правки:",
          JSON.stringify(value),
        ].join("\n\n"),
      },
    ],
    temperature: 0.1,
    maxTokens: 2000,
    responseFormat: "json_object",
  });
  console.log(`[blocks][refine] done label="${label}" in ${Date.now() - startedAt}ms chars=${raw.length}`);
  await logBlockEvent({
    scope: "blocks.refine",
    message: "done",
    data: { label, elapsedMs: Date.now() - startedAt, chars: raw.length },
  });
  return tryParseJson(raw) as T;
}
