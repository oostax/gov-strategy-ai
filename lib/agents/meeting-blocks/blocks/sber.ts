import type { MeetingBlockDeps, SberBlockOutput } from "../types";
import type { SberAction } from "@/lib/schemas/structured-output";
import {
  prepareBlockSources,
  callBlockLLM,
  parseBlockJson,
  hasUsefulText,
  normalizeHypotheses,
  normalizeSources,
  buildContextPreamble,
  buildMinistryContext,
  isRecord,
} from "./base";
import { SBER_SYSTEM_PROMPT, volumeDirective } from "@/lib/prompts/meeting-blocks-contract";

export async function generateSberBlock(
  deps: MeetingBlockDeps,
  searchQueries: string[],
): Promise<SberBlockOutput> {
  const { webEvidence, sources } = await prepareBlockSources(deps, searchQueries, {
    kind: "sber",
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
    buildThesesContext(deps),
    "",
    `Сырые открытые источники (кейсы Сбера в госсекторе, активы):\n${webEvidence}`,
    "",
    "Опиши участие Сбера: 2-3 предметных sberActions (актив, первые 2 недели, данные, артефакт, коммерческий шаг), proposal и artifact.",
    "Если рынок подрядчиков плотный — позиционируй как надстройку через API, а не замену. Не выдумывай сделки и доли.",
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await callBlockLLM(SBER_SYSTEM_PROMPT, userMessage, deps.agentInstructions, {
    sessionId: deps.session.id,
    runId: deps.runId,
    label: "sber",
    maxTokens: 1500,
  });
  const parsed = parseBlockJson(raw) as {
    sberActions?: unknown;
    proposal?: unknown;
    artifact?: unknown;
    leaveAfter?: unknown;
    sources?: unknown;
    hypotheses?: unknown;
  };

  return {
    sberActions: normalizeSberActions(parsed.sberActions),
    proposal: hasUsefulText(parsed.proposal) ? parsed.proposal.trim() : undefined,
    artifact: hasUsefulText(parsed.artifact) ? parsed.artifact.trim() : undefined,
    leaveAfter: hasUsefulText(parsed.leaveAfter) ? parsed.leaveAfter.trim() : undefined,
    sources: normalizeSources(parsed.sources).concat(sources).slice(0, 8),
    hypotheses: normalizeHypotheses(parsed.hypotheses),
  };
}

function buildThesesContext(deps: MeetingBlockDeps): string {
  const theses = deps.priorBlocks?.find((b) => b.kind === "theses")?.data;
  if (!isRecord(theses) || !Array.isArray(theses.theses)) return "";
  const items = theses.theses
    .filter(isRecord)
    .map((t) => String(t.text ?? ""))
    .filter(Boolean)
    .slice(0, 4);
  return items.length ? `Тезисы Сбера на встречу:\n${items.map((t) => `- ${t}`).join("\n")}` : "";
}

function normalizeSberActions(value: unknown): SberAction[] {
  if (!Array.isArray(value)) return [];
  const result: SberAction[] = [];
  for (let i = 0; i < value.length && result.length < 4; i++) {
    const item = value[i];
    if (!isRecord(item) || !hasUsefulText(item.asset)) continue;
    result.push({
      id: hasUsefulText(item.id) ? item.id : `sber_${result.length + 1}`,
      asset: item.asset.trim(),
      firstTwoWeeks: hasUsefulText(item.firstTwoWeeks) ? item.firstTwoWeeks.trim() : "",
      dataNeeded: hasUsefulText(item.dataNeeded) ? item.dataNeeded.trim() : "",
      artifact: hasUsefulText(item.artifact) ? item.artifact.trim() : "",
      commercialNextStep: hasUsefulText(item.commercialNextStep) ? item.commercialNextStep.trim() : "",
    });
  }
  return result;
}
