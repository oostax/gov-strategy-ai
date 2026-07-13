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
  pickString,
} from "./base";
import { AGENDA_SYSTEM_PROMPT, volumeDirective } from "@/lib/prompts/meeting-blocks-contract";
import { assessAgenda, isCompleteAgendaItem } from "@/lib/quality/meeting-output-quality";

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

  const contextBlock = [
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
  ]
    .filter(Boolean)
    .join("\n");

  const userMessage = [
    contextBlock,
    "",
    "Составь сценарий встречи на 30 минут: 4-5 блоков. У каждого непустые time, topic, sberSays, askLpr, fixDecision.",
    "Заложи вход/мостик, признание успеха, диагноз-вопрос (развилка), оффер, фиксацию next step. Сформулируй askLadder (max/target/min).",
  ].join("\n");

  const raw = await callBlockLLM(AGENDA_SYSTEM_PROMPT, userMessage, deps.agentInstructions, {
    sessionId: deps.session.id,
    runId: deps.runId,
    label: "agenda",
    maxTokens: 1800,
  });
  const parsed = parseBlockJson(raw) as { agenda?: unknown; askLadder?: unknown; sources?: unknown; hypotheses?: unknown };

  let agenda = normalizeAgenda(parsed.agenda);
  // Salvage нужен не только при пустом массиве. Reasoning-модель часто возвращает
  // 4-5 строк с time/topic, но оставляет пустыми sberSays/askLpr/fixDecision.
  // Такой массив визуально выглядит готовым, хотя провести по нему встречу нельзя.
  if (!assessAgenda(agenda).ready) {
    agenda = await salvageAgenda(deps, contextBlock);
  }
  const agendaQuality = assessAgenda(agenda);
  if (!agendaQuality.ready) {
    throw new Error(
      `Agenda incomplete after salvage: ${agendaQuality.complete}/${agendaQuality.total} complete`,
    );
  }

  return {
    agenda,
    askLadder: normalizeAskLadder(parsed.askLadder),
    sources: normalizeSources(parsed.sources).concat(sources).slice(0, 6),
    hypotheses: normalizeHypotheses(parsed.hypotheses),
  };
}

/**
 * Узкий повторный вызов: просим ТОЛЬКО массив agenda с обязательными полями и
 * примером. Снимает системную ошибку reasoning-модели, роняющей вложенный массив.
 */
async function salvageAgenda(deps: MeetingBlockDeps, contextBlock: string): Promise<AgendaBlock[]> {
  const salvageMessage = [
    contextBlock,
    "",
    'Верни ТОЛЬКО JSON вида {"agenda":[ ... ]} — БЕЗ каких-либо других полей.',
    "Ровно 4-5 объектов сценария 30-минутной встречи. У КАЖДОГО объекта ОБЯЗАТЕЛЬНЫ непустые: time, topic, sberSays, askLpr, fixDecision.",
    "Структура: вход/личный мостик → признание успеха → диагноз-вопрос (развилка) → оффер → фиксация next step.",
    'Пример одного элемента: {"id":"a_1","time":"0-3 мин","topic":"Вход и мостик","sberSays":"...","askLpr":"...","fixDecision":"..."}',
  ].join("\n");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await callBlockLLM(AGENDA_SYSTEM_PROMPT, salvageMessage, deps.agentInstructions, {
        sessionId: deps.session.id,
        runId: deps.runId,
        label: `agenda.salvage.${attempt + 1}`,
        maxTokens: 1800,
      });
      const parsed = parseBlockJson(raw) as { agenda?: unknown };
      const agenda = normalizeAgenda(parsed.agenda);
      if (assessAgenda(agenda).ready) return agenda;
    } catch {
      /* следующая попытка */
    }
  }
  return [];
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
    // Толерантность к синонимам ключей (reasoning-модель варьирует названия).
    const topic = pickString(item, ["topic", "subject", "title", "about", "theme"]);
    const sberSays = pickString(item, ["sberSays", "say", "says", "script", "message", "line", "speech"]);
    const askLpr = pickString(item, ["askLpr", "ask", "question", "probe", "askQuestion"]);
    const fixDecision = pickString(item, ["fixDecision", "decision", "fix", "nextStep", "outcome", "result"]);
    const time = pickString(item, ["time", "timing", "slot", "duration"]);
    const normalized: AgendaBlock = {
      id: pickString(item, ["id"]) || `a_${result.length + 1}`,
      time: time || `${result.length * 6}-${(result.length + 1) * 6} мин`,
      topic: topic || sberSays,
      sberSays,
      askLpr,
      fixDecision,
    };
    // В UI строка считается готовой только при наличии всех пяти полей.
    if (!isCompleteAgendaItem(normalized)) continue;
    result.push(normalized);
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
