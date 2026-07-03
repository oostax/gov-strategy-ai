/**
 * Общие примитивы блоков встречи: поиск → извлечение → генерация.
 * Аналог lib/agents/region-blocks/blocks/base.ts. Каждый блок:
 *   prepareBlockSources → callBlockLLM(json_object) → parseBlockJson →
 *   guard факта → (fallback-поиск skipCache при пустоте) → нормализация.
 */

import { callLLM } from "@/lib/agents/llm-client";
import {
  retrieveOpenSources,
  formatEvidenceForPrompt,
} from "@/lib/integrations/web-retrieval";
import type { Source, SourceTier } from "@/lib/schemas/structured-output";
import type { MeetingBlockDeps, MeetingBlockKind } from "../types";
import { tryParseJson } from "@/lib/utils/json";
import { logBlockEvent } from "@/lib/agents/region-blocks/logger";
import { cacheKeyForMinistry, getOrRefreshMeetingEvidence } from "../cache";

const VALID_TIERS: SourceTier[] = ["fact", "hypothesis", "crm", "ask"];

/** Разрешён ли tier="fact": только когда есть source с реальным url. */
export function coerceTier(
  tier: unknown,
  hasSource: boolean,
  fallback: SourceTier = "hypothesis",
): SourceTier {
  const value = typeof tier === "string" ? (tier.trim().toLowerCase() as SourceTier) : fallback;
  const normalized = VALID_TIERS.includes(value) ? value : fallback;
  // Факт без источника недопустим — понижаем до гипотезы (tier-дисциплина).
  if (normalized === "fact" && !hasSource) return "hypothesis";
  return normalized;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Нормализует источник факта: возвращает Source только если есть непустой url. */
export function normalizeFactSource(value: unknown): Source | undefined {
  if (!isRecord(value)) return undefined;
  const url = typeof value.url === "string" ? value.url.trim() : "";
  const title = typeof value.title === "string" ? value.title.trim() : "";
  if (!url && !title) return undefined;
  if (url && !/^https?:\/\//i.test(url)) {
    // Некорректный url — считаем источник неподтверждённым.
    if (!title) return undefined;
    return { title, url: undefined, excerpt: hasUsefulText(value.excerpt) ? String(value.excerpt) : "", isVerified: false };
  }
  return {
    title: title || url,
    url: url || undefined,
    excerpt: hasUsefulText(value.excerpt) ? String(value.excerpt).slice(0, 220) : "",
    isVerified: Boolean(url),
  };
}

export async function prepareBlockSources(
  deps: MeetingBlockDeps,
  queries: string[],
  options: {
    kind?: MeetingBlockKind;
    skipCache?: boolean;
    maxFullTextChars?: number;
    limit?: number;
  } = {},
): Promise<{ webEvidence: string; sources: Source[] }> {
  if (deps.webEvidence) {
    return { webEvidence: deps.webEvidence, sources: deps.collectedSources || [] };
  }

  const cleanedQueries = Array.from(
    new Set(queries.map((q) => q.replace(/\s+/g, " ").trim()).filter(Boolean)),
  ).slice(0, 6);

  const startedAt = Date.now();

  // Кэш ведомства: только для не-fallback вызовов с известным kind.
  if (options.kind && !options.skipCache && cleanedQueries.length) {
    try {
      const cacheKey = cacheKeyForMinistry(deps.region, deps.ministry || deps.lprName || deps.focusTopic);
      const cached = await getOrRefreshMeetingEvidence(
        cacheKey,
        deps.region,
        deps.ministry || deps.lprName || "",
        options.kind,
        cleanedQueries,
      );
      if (cached) {
        console.log(
          `[meeting-blocks][sources] cache path kind=${options.kind} age=${Math.round(
            (Date.now() - new Date(cached.fetchedAt).getTime()) / 1000,
          )}s`,
        );
        await logBlockEvent({
          sessionId: deps.session.id,
          runId: deps.runId,
          scope: "meeting.sources",
          message: "cache_or_refresh",
          data: { kind: options.kind, elapsedMs: Date.now() - startedAt },
        });
        return { webEvidence: cached.evidenceText, sources: cached.sources };
      }
    } catch (err) {
      console.warn(
        `[meeting-blocks][sources] cache miss, live search: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  await logBlockEvent({
    sessionId: deps.session.id,
    runId: deps.runId,
    scope: "meeting.sources",
    message: "start",
    data: { region: deps.region, queries: cleanedQueries, skipCache: Boolean(options.skipCache) },
  });

  const evidence = await retrieveOpenSources({
    region: deps.region,
    focusTopic: cleanedQueries.slice(0, 2).join(" "),
    queries: cleanedQueries,
    limit: options.limit ?? 4,
  });
  console.log(
    `[meeting-blocks][sources] done in ${Date.now() - startedAt}ms returned=${evidence.length}`,
  );
  await logBlockEvent({
    sessionId: deps.session.id,
    runId: deps.runId,
    scope: "meeting.sources",
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
  logContext?: { sessionId?: string; runId?: string; label?: string; maxTokens?: number },
): Promise<string> {
  const instructions = agentInstructions.trim()
    ? `\n\nАктуальные инструкции агента из playbook и отзывов:\n${agentInstructions.trim()}`
    : "";
  const startedAt = Date.now();
  await logBlockEvent({
    sessionId: logContext?.sessionId,
    runId: logContext?.runId,
    scope: "meeting.llm",
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
    maxTokens: logContext?.maxTokens ?? 1400,
    responseFormat: "json_object",
  });
  await logBlockEvent({
    sessionId: logContext?.sessionId,
    runId: logContext?.runId,
    scope: "meeting.llm",
    message: "done",
    data: { label: logContext?.label, elapsedMs: Date.now() - startedAt, chars: raw.length },
  });
  return raw;
}

export function buildContextPreamble(deps: MeetingBlockDeps): string {
  return [
    deps.regionContext
      ? `Контекст из карточки региона и сохранённых данных:\n${deps.regionContext}`
      : "",
    deps.sberProjectsContext
      ? `\nРелевантные реальные проекты и активы Сбера:\n${deps.sberProjectsContext}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Сжатый контекст портрета ведомства для зависимых блоков (theses/objections/…),
 * собирается из priorBlocks. Держит весь материал на одних фактах.
 */
export function buildMinistryContext(deps: MeetingBlockDeps): string {
  const ministry = deps.priorBlocks?.find((b) => b.kind === "ministry")?.data;
  if (!isRecord(ministry)) return "";
  const portrait = ministry.ministryPortrait;
  if (!isRecord(portrait)) return "";
  const lines: string[] = ["Ключевые факты о ведомстве (из блока «Портрет ведомства»):"];
  const bw = portrait.budgetWindow;
  if (isRecord(bw)) {
    if (hasUsefulText(bw.signal)) lines.push(`- Бюджетный сигнал: ${String(bw.signal).slice(0, 220)}`);
    if (hasUsefulText(bw.tension)) lines.push(`- Напряжение: ${String(bw.tension).slice(0, 220)}`);
    if (hasUsefulText(bw.decision)) lines.push(`- Как заходить: ${String(bw.decision).slice(0, 220)}`);
  }
  if (Array.isArray(portrait.stats)) {
    for (const stat of portrait.stats.slice(0, 4)) {
      if (isRecord(stat) && hasUsefulText(stat.value)) {
        lines.push(`- Показатель: ${String(stat.label ?? "")} — ${String(stat.value)} (${String(stat.caption ?? "")})`.slice(0, 220));
      }
    }
  }
  if (Array.isArray(portrait.initiatives)) {
    const titles = portrait.initiatives
      .filter(isRecord)
      .map((i) => String(i.title ?? ""))
      .filter(Boolean)
      .slice(0, 3);
    if (titles.length) lines.push(`- Инициативы (зацепки): ${titles.join("; ")}`);
  }
  if (Array.isArray(portrait.incumbents)) {
    const titles = portrait.incumbents
      .filter(isRecord)
      .map((i) => String(i.title ?? ""))
      .filter(Boolean)
      .slice(0, 3);
    if (titles.length) lines.push(`- Уже внедрено (конкуренты/интеграция): ${titles.join("; ")}`);
  }
  const dossier = deps.priorBlocks?.find((b) => b.kind === "dossier")?.data;
  if (isRecord(dossier) && isRecord(dossier.lprDossier)) {
    const d = dossier.lprDossier;
    if (isRecord(d.known) && hasUsefulText(d.known.text)) {
      lines.push(`- ЛПР известно: ${String(d.known.text).slice(0, 220)}`);
    }
    if (isRecord(d.motive) && hasUsefulText(d.motive.text)) {
      lines.push(`- ЛПР мотив (гипотеза): ${String(d.motive.text).slice(0, 200)}`);
    }
  }
  return lines.length > 1 ? lines.join("\n") : "";
}

export function parseBlockJson(raw: string): unknown {
  return tryParseJson(raw);
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
      const text = [record.statement, record.title, record.question, record.reason].find(
        (part): part is string => typeof part === "string" && part.trim().length > 0,
      );
      if (text) result.push(text.trim());
    }
  }
  return Array.from(new Set(result)).slice(0, 8);
}

export function normalizeSources(value: unknown): Source[] {
  if (!Array.isArray(value)) return [];
  const result: Source[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.title !== "string" || !item.title.trim()) continue;
    result.push({
      title: item.title.trim(),
      url: typeof item.url === "string" && item.url.trim() ? item.url.trim() : undefined,
      excerpt: hasUsefulText(item.excerpt) ? String(item.excerpt).slice(0, 220) : "",
      isVerified: item.isVerified === true,
    });
  }
  return result;
}
