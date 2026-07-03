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
  pickString,
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

  const contextBlock = [
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
  ]
    .filter(Boolean)
    .join("\n");

  const userMessage = [
    contextBlock,
    "",
    "Опиши участие Сбера: 2-3 предметных sberActions (актив, первые 2 недели, данные, артефакт, коммерческий шаг), proposal и artifact.",
    "Если рынок подрядчиков плотный — позиционируй как надстройку через API, а не замену. Не выдумывай сделки и доли.",
  ].join("\n");

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

  const proposal = hasUsefulText(parsed.proposal) ? parsed.proposal.trim() : undefined;
  let sberActions = normalizeSberActions(parsed.sberActions);
  // Salvage: модель заполняет proposal, но нередко роняет массив sberActions —
  // добираем его отдельным узким вызовом с опорой на уже готовый оффер.
  if (sberActions.length === 0) {
    sberActions = await salvageSberActions(deps, contextBlock, proposal);
  }

  return {
    sberActions,
    proposal,
    artifact: hasUsefulText(parsed.artifact) ? parsed.artifact.trim() : undefined,
    leaveAfter: hasUsefulText(parsed.leaveAfter) ? parsed.leaveAfter.trim() : undefined,
    sources: normalizeSources(parsed.sources).concat(sources).slice(0, 8),
    hypotheses: normalizeHypotheses(parsed.hypotheses),
  };
}

/**
 * Узкий повторный вызов: просим ТОЛЬКО массив sberActions с обязательным asset
 * и примером, опираясь на уже сформулированный proposal.
 */
async function salvageSberActions(
  deps: MeetingBlockDeps,
  contextBlock: string,
  proposal: string | undefined,
): Promise<SberAction[]> {
  const salvageMessage = [
    contextBlock,
    proposal ? `\nУже сформулированный оффер (proposal): ${proposal}` : "",
    "",
    'Верни ТОЛЬКО JSON вида {"sberActions":[ ... ]} — БЕЗ каких-либо других полей.',
    "2-3 предметных хода Сбера. У КАЖДОГО объекта ОБЯЗАТЕЛЬНЫ непустые: asset, firstTwoWeeks, dataNeeded, artifact, commercialNextStep. Без общих слов «помочь с ИИ».",
    'Пример: {"id":"sber_1","asset":"GigaChat for Business в ИБ-контуре","firstTwoWeeks":"...","dataNeeded":"...","artifact":"one-pager","commercialNextStep":"пилот в 1 отрасли"}',
  ]
    .filter(Boolean)
    .join("\n");
  try {
    const raw = await callBlockLLM(SBER_SYSTEM_PROMPT, salvageMessage, deps.agentInstructions, {
      sessionId: deps.session.id,
      runId: deps.runId,
      label: "sber.salvage",
      maxTokens: 1400,
    });
    const parsed = parseBlockJson(raw) as { sberActions?: unknown };
    return normalizeSberActions(parsed.sberActions);
  } catch {
    return [];
  }
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
    if (!isRecord(item)) continue;
    // Толерантность к синонимам ключей (reasoning-модель варьирует названия).
    const asset = pickString(item, ["asset", "title", "name", "action", "solution", "product", "tool"]);
    if (!asset) continue;
    result.push({
      id: pickString(item, ["id"]) || `sber_${result.length + 1}`,
      asset,
      firstTwoWeeks: pickString(item, ["firstTwoWeeks", "firstSteps", "immediate", "next2weeks", "firstMoves"]),
      dataNeeded: pickString(item, ["dataNeeded", "data", "dataRequired", "needData"]),
      artifact: pickString(item, ["artifact", "deliverable", "leaveBehind", "output"]),
      commercialNextStep: pickString(item, ["commercialNextStep", "nextStep", "commercial", "next", "followUp"]),
    });
  }
  return result;
}
