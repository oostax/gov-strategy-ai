import type { MeetingBlockDeps, AgendaBlockOutput } from "../types";
import type { AgendaBlock, AskLadder } from "@/lib/schemas/structured-output";
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
import { AGENDA_SYSTEM_PROMPT, volumeDirective } from "@/lib/prompts/meeting-blocks-contract";

export async function generateAgendaBlock(
  deps: MeetingBlockDeps,
  searchQueries: string[],
): Promise<AgendaBlockOutput> {
  // agenda обычно синтезируется из контекста; поиск — только если план дал запросы.
  let webEvidence = "";
  let sources: AgendaBlockOutput["sources"] = [];
  if (searchQueries.length) {
    ({ webEvidence, sources } = await prepareBlockSources(deps, searchQueries, {
      kind: "agenda",
      limit: 2,
    }));
  }

  const userMessage = [
    `Регион: ${deps.region}`,
    deps.ministry ? `Ведомство: ${deps.ministry}` : "",
    deps.lprName ? `ЛПР: ${deps.lprName}${deps.lprRole ? `, ${deps.lprRole}` : ""}` : "",
    `Тема встречи: ${deps.focusTopic}`,
    volumeDirective(deps.session.materialPlan?.volume),
    "",
    buildContextPreamble(deps),
    buildMinistryContext(deps),
    buildTacticalContext(deps),
    webEvidence ? `\nСвежая повестка (источники):\n${webEvidence}` : "",
    "",
    "Составь сценарий встречи на 30 минут: 4-5 блоков. У каждого непустые time, topic, sberSays, askLpr, fixDecision.",
    "Заложи вход/мостик, признание успеха, диагноз-вопрос (развилка), оффер, фиксацию next step. Сформулируй askLadder (max/target/min).",
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await callBlockLLM(AGENDA_SYSTEM_PROMPT, userMessage, deps.agentInstructions, {
    sessionId: deps.session.id,
    runId: deps.runId,
    label: "agenda",
    maxTokens: 1800,
  });
  const parsed = parseBlockJson(raw) as { agenda?: unknown; askLadder?: unknown; sources?: unknown; hypotheses?: unknown };

  return {
    agenda: normalizeAgenda(parsed.agenda),
    askLadder: normalizeAskLadder(parsed.askLadder),
    sources: normalizeSources(parsed.sources).concat(sources).slice(0, 6),
    hypotheses: normalizeHypotheses(parsed.hypotheses),
  };
}

/** Контекст тезисов/возражений/участия Сбера для сценария. */
function buildTacticalContext(deps: MeetingBlockDeps): string {
  const lines: string[] = [];
  const theses = deps.priorBlocks?.find((b) => b.kind === "theses")?.data;
  if (isRecord(theses) && Array.isArray(theses.theses)) {
    const items = theses.theses.filter(isRecord).map((t) => String(t.text ?? "")).filter(Boolean).slice(0, 4);
    if (items.length) lines.push(`Тезисы:\n${items.map((t) => `- ${t}`).join("\n")}`);
  }
  const objections = deps.priorBlocks?.find((b) => b.kind === "objections")?.data;
  if (isRecord(objections) && Array.isArray(objections.objections)) {
    const items = objections.objections.filter(isRecord).map((o) => String(o.objection ?? "")).filter(Boolean).slice(0, 4);
    if (items.length) lines.push(`Ожидаемые возражения:\n${items.map((o) => `- ${o}`).join("\n")}`);
  }
  const sber = deps.priorBlocks?.find((b) => b.kind === "sber")?.data;
  if (isRecord(sber) && hasUsefulText(sber.proposal)) {
    lines.push(`Оффер Сбера: ${String(sber.proposal).slice(0, 300)}`);
  }
  return lines.join("\n\n");
}

function normalizeAgenda(value: unknown): AgendaBlock[] {
  if (!Array.isArray(value)) return [];
  const result: AgendaBlock[] = [];
  for (let i = 0; i < value.length && result.length < 6; i++) {
    const item = value[i];
    if (!isRecord(item)) continue;
    if (!hasUsefulText(item.topic) || !hasUsefulText(item.sberSays)) continue;
    result.push({
      id: hasUsefulText(item.id) ? item.id : `a_${result.length + 1}`,
      time: hasUsefulText(item.time) ? item.time.trim() : `${result.length * 6}-${(result.length + 1) * 6} мин`,
      topic: item.topic.trim(),
      sberSays: item.sberSays.trim(),
      askLpr: hasUsefulText(item.askLpr) ? item.askLpr.trim() : "",
      fixDecision: hasUsefulText(item.fixDecision) ? item.fixDecision.trim() : "",
    });
  }
  return result;
}

function normalizeAskLadder(value: unknown): AskLadder | undefined {
  if (!isRecord(value)) return undefined;
  const max = hasUsefulText(value.max) ? value.max.trim() : undefined;
  const target = hasUsefulText(value.target) ? value.target.trim() : undefined;
  const min = hasUsefulText(value.min) ? value.min.trim() : undefined;
  if (!max && !target && !min) return undefined;
  return { max, target, min };
}
