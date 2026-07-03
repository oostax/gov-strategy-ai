import type { MeetingBlockDeps, ObjectionsBlockOutput } from "../types";
import type { Objection } from "@/lib/schemas/structured-output";
import {
  prepareBlockSources,
  callBlockLLM,
  parseBlockJson,
  hasUsefulText,
  normalizeHypotheses,
  normalizeSources,
  coerceTier,
  buildContextPreamble,
  buildMinistryContext,
  isRecord,
} from "./base";
import { OBJECTIONS_SYSTEM_PROMPT, volumeDirective } from "@/lib/prompts/meeting-blocks-contract";

export async function generateObjectionsBlock(
  deps: MeetingBlockDeps,
  searchQueries: string[],
): Promise<ObjectionsBlockOutput> {
  const { webEvidence, sources } = await prepareBlockSources(deps, searchQueries, {
    kind: "objections",
    limit: 4,
  });

  const userMessage = [
    `Регион: ${deps.region}`,
    deps.ministry ? `Ведомство: ${deps.ministry}` : "",
    `Тема встречи: ${deps.focusTopic}`,
    volumeDirective(deps.session.materialPlan?.volume),
    "",
    buildContextPreamble(deps),
    buildMinistryContext(deps),
    "",
    `Сырые открытые источники (обоснование возражений — дефицит, импортозамещение, реестр ПО):\n${webEvidence}`,
    "",
    "Составь 3-5 возражений именно этого ЛПР/ведомства. Каждое целиком: objection, trueReason, response, factNeeded, fallback.",
    "Выводи из реальных фактов региона (дефицит бюджета из портрета, свой флагман/подрядчики). Не ссылайся на дефицит, если его нет в портрете.",
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await callBlockLLM(OBJECTIONS_SYSTEM_PROMPT, userMessage, deps.agentInstructions, {
    sessionId: deps.session.id,
    runId: deps.runId,
    label: "objections",
    maxTokens: 1600,
  });
  const parsed = parseBlockJson(raw) as { objections?: unknown; sources?: unknown; hypotheses?: unknown };

  return {
    objections: normalizeObjections(parsed.objections),
    sources: normalizeSources(parsed.sources).concat(sources).slice(0, 8),
    hypotheses: normalizeHypotheses(parsed.hypotheses),
  };
}

function normalizeObjections(value: unknown): Objection[] {
  if (!Array.isArray(value)) return [];
  const result: Objection[] = [];
  for (let i = 0; i < value.length && result.length < 6; i++) {
    const item = value[i];
    if (!isRecord(item)) continue;
    if (!hasUsefulText(item.objection) || !hasUsefulText(item.response)) continue;
    result.push({
      id: hasUsefulText(item.id) ? item.id : `obj_${result.length + 1}`,
      objection: item.objection.trim(),
      response: item.response.trim(),
      factNeeded: hasUsefulText(item.factNeeded) ? item.factNeeded.trim() : "",
      trueReason: hasUsefulText(item.trueReason) ? item.trueReason.trim() : undefined,
      fallback: hasUsefulText(item.fallback) ? item.fallback.trim() : undefined,
      tier: coerceTier(item.tier, false),
      specific: item.specific === true,
    });
  }
  return result;
}
