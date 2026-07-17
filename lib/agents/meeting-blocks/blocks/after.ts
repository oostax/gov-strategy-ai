import type { MeetingBlockDeps, AfterBlockOutput } from "../types";
import type { MeetingAfter, MeetingOutcome, NextStep } from "@/lib/schemas/structured-output";
import {
  callBlockLLM,
  parseBlockJson,
  hasUsefulText,
  normalizeHypotheses,
  normalizeSources,
  buildMinistryContext,
  isRecord,
} from "./base";
import { AFTER_SYSTEM_PROMPT, volumeDirective } from "@/lib/prompts/meeting-blocks-contract";

export async function generateAfterBlock(
  deps: MeetingBlockDeps,
): Promise<AfterBlockOutput> {
  // «После встречи» синтезируется из контекста (agenda/sber), без нового поиска.
  const userMessage = [
    `Регион: ${deps.region}`,
    deps.ministry ? `Ведомство: ${deps.ministry}` : "",
    `Тема встречи: ${deps.focusTopic}`,
    volumeDirective(deps.session.materialPlan?.volume),
    // Режим правки одного блока (волна 8.5). Пусто при обычной генерации.
    deps.modeDirective ? deps.modeDirective.trim() : "",
    "",
    buildMinistryContext(deps),
    buildFollowUpContext(deps),
    "",
    "Опиши механику после встречи: для каждого исхода (ifYes/ifPause/ifNo) — triggerSignal, 2-3 шага с owner+deadline, whatToCapture.",
    "Дай first48h (2-3 действия сразу). Продублируй шаги в плоские ifYes/ifPause/ifNo. Шаги конкретны, owner — должность.",
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await callBlockLLM(AFTER_SYSTEM_PROMPT, userMessage, deps.agentInstructions, {
    sessionId: deps.session.id,
    runId: deps.runId,
    label: "after",
    maxTokens: 1600,
  });
  const parsed = parseBlockJson(raw) as {
    afterMeeting?: unknown;
    ifYes?: unknown;
    ifPause?: unknown;
    ifNo?: unknown;
    sources?: unknown;
    hypotheses?: unknown;
  };

  const afterMeeting = normalizeAfter(parsed.afterMeeting);
  const ifYes = afterMeeting.outcomes?.ifYes?.steps ?? normalizeSteps(parsed.ifYes);
  const ifPause = afterMeeting.outcomes?.ifPause?.steps ?? normalizeSteps(parsed.ifPause);
  const ifNo = afterMeeting.outcomes?.ifNo?.steps ?? normalizeSteps(parsed.ifNo);

  return {
    afterMeeting,
    ifYes,
    ifPause,
    ifNo,
    sources: normalizeSources(parsed.sources).slice(0, 4),
    hypotheses: normalizeHypotheses(parsed.hypotheses),
  };
}

function buildFollowUpContext(deps: MeetingBlockDeps): string {
  const lines: string[] = [];
  const sber = deps.priorBlocks?.find((b) => b.kind === "sber")?.data;
  if (isRecord(sber) && Array.isArray(sber.sberActions)) {
    const items = sber.sberActions
      .filter(isRecord)
      .map((a) => String(a.commercialNextStep ?? a.asset ?? ""))
      .filter(Boolean)
      .slice(0, 3);
    if (items.length) lines.push(`Коммерческие шаги Сбера:\n${items.map((a) => `- ${a}`).join("\n")}`);
  }
  const agenda = deps.priorBlocks?.find((b) => b.kind === "agenda")?.data;
  if (isRecord(agenda) && Array.isArray(agenda.agenda)) {
    const fixes = agenda.agenda
      .filter(isRecord)
      .map((a) => String(a.fixDecision ?? ""))
      .filter(Boolean)
      .slice(0, 3);
    if (fixes.length) lines.push(`Что фиксируем на встрече:\n${fixes.map((f) => `- ${f}`).join("\n")}`);
  }
  return lines.join("\n\n");
}

function normalizeSteps(value: unknown): NextStep[] {
  if (!Array.isArray(value)) return [];
  const result: NextStep[] = [];
  for (let i = 0; i < value.length && result.length < 4; i++) {
    const item = value[i];
    if (!isRecord(item) || !hasUsefulText(item.action)) continue;
    result.push({
      id: hasUsefulText(item.id) ? item.id : `step_${result.length + 1}`,
      action: item.action.trim(),
      owner: hasUsefulText(item.owner) ? item.owner.trim() : "",
      deadline: hasUsefulText(item.deadline) ? item.deadline.trim() : "",
    });
  }
  return result;
}

function normalizeOutcome(value: unknown): MeetingOutcome | undefined {
  if (!isRecord(value)) return undefined;
  const steps = normalizeSteps(value.steps);
  const triggerSignal = hasUsefulText(value.triggerSignal) ? value.triggerSignal.trim() : "";
  const whatToCapture = hasUsefulText(value.whatToCapture) ? value.whatToCapture.trim() : "";
  if (!steps.length && !triggerSignal && !whatToCapture) return undefined;
  return { triggerSignal, steps, whatToCapture };
}

function normalizeAfter(value: unknown): MeetingAfter {
  if (!isRecord(value)) return {};
  const outcomes = isRecord(value.outcomes) ? value.outcomes : {};
  return {
    outcomes: {
      ifYes: normalizeOutcome(outcomes.ifYes),
      ifPause: normalizeOutcome(outcomes.ifPause),
      ifNo: normalizeOutcome(outcomes.ifNo),
    },
    first48h: normalizeSteps(value.first48h),
  };
}
