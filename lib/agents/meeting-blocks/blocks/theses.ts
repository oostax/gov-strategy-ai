import type { MeetingBlockDeps, ThesesBlockOutput } from "../types";
import type { MeetingThesis } from "@/lib/schemas/structured-output";
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
import { THESES_SYSTEM_PROMPT, volumeDirective } from "@/lib/prompts/meeting-blocks-contract";

export async function generateThesesBlock(
  deps: MeetingBlockDeps,
  searchQueries: string[],
): Promise<ThesesBlockOutput> {
  // theses наследуют факты ministry через контекст; свой поиск — кейсы/эффекты.
  const { webEvidence, sources } = await prepareBlockSources(deps, searchQueries, {
    kind: "theses",
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
    `Сырые открытые источники (кейсы/эффекты):\n${webEvidence}`,
    "",
    "Сформулируй 3-4 тезиса под повестку ЛПР. Каждый привязан к КОНКРЕТНОМУ факту/KPI ведомства (из портрета) через tiedTo.",
    "tier='fact' только если tiedTo опирается на факт из источников/портрета. Сформулируй mainThesis — один главный тезис.",
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await callBlockLLM(THESES_SYSTEM_PROMPT, userMessage, deps.agentInstructions, {
    sessionId: deps.session.id,
    runId: deps.runId,
    label: "theses",
    maxTokens: 1500,
  });
  const parsed = parseBlockJson(raw) as { theses?: unknown; mainThesis?: unknown; sources?: unknown; hypotheses?: unknown };

  return {
    theses: normalizeTheses(parsed.theses),
    mainThesis: hasUsefulText(parsed.mainThesis) ? parsed.mainThesis.trim() : undefined,
    sources: normalizeSources(parsed.sources).concat(sources).slice(0, 8),
    hypotheses: normalizeHypotheses(parsed.hypotheses),
  };
}

function normalizeTheses(value: unknown): MeetingThesis[] {
  if (!Array.isArray(value)) return [];
  const result: MeetingThesis[] = [];
  for (let i = 0; i < value.length && result.length < 5; i++) {
    const item = value[i];
    if (!isRecord(item) || !hasUsefulText(item.text)) continue;
    result.push({
      id: hasUsefulText(item.id) ? item.id : `th_${result.length + 1}`,
      text: item.text.trim(),
      tiedTo: hasUsefulText(item.tiedTo) ? item.tiedTo.trim() : "",
      evidence: hasUsefulText(item.evidence) ? item.evidence.trim() : "",
      // tier=fact допустим только если тезис привязан к факту (tiedTo непустой).
      tier: coerceTier(item.tier, hasUsefulText(item.tiedTo)),
    });
  }
  return result;
}
