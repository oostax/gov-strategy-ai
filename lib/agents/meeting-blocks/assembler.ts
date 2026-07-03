/**
 * Сборка блоков встречи в существующий MeetingOutput (дашборд не меняется).
 * mergeBlockData раскладывает данные блока по полям MeetingOutput; источники и
 * гипотезы дедуплицируются; sanitizeMeetingShape режет пустые элементы; мягкий
 * гейт assertMeetingOutputReady не роняет сессию из-за одного пустого блока.
 */

import type {
  MeetingOutput,
  Source,
  TypedOutput,
} from "@/lib/schemas/structured-output";
import { MEETING_BLOCK_ORDER, type MeetingBlockKind } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeKey(value: Source) {
  return (value.url || value.title || "").trim().replace(/\/$/, "").toLowerCase();
}

function appendSources(target: Source[], value: unknown) {
  if (!Array.isArray(value)) return;
  const seen = new Set(target.map(normalizeKey));
  for (const item of value) {
    if (!isRecord(item) || typeof item.title !== "string") continue;
    const source: Source = {
      title: item.title,
      url: typeof item.url === "string" ? item.url : undefined,
      excerpt: typeof item.excerpt === "string" ? item.excerpt : "",
      isVerified: item.isVerified === true,
    };
    const key = normalizeKey(source);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    target.push(source);
  }
}

function appendHypotheses(target: string[], value: unknown) {
  if (!Array.isArray(value)) return;
  const seen = new Set(target.map((item) => item.toLowerCase().trim()));
  for (const item of value) {
    const text = typeof item === "string" ? item : "";
    const normalized = text.trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    target.push(normalized);
  }
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/** Раскладывает данные блока по kind в поля собираемого MeetingOutput. */
function mergeBlockData(
  collected: Partial<MeetingOutput>,
  kind: MeetingBlockKind,
  data: unknown,
) {
  if (!isRecord(data)) return;

  if (kind === "ministry") {
    if (isRecord(data.ministryPortrait)) {
      collected.ministryPortrait = data.ministryPortrait as MeetingOutput["ministryPortrait"];
    }
    if (nonEmpty(data.meetingGoalSeed) && !nonEmpty(collected.meetingGoal)) {
      collected.meetingGoal = (data.meetingGoalSeed as string).trim();
    }
  }
  if (kind === "dossier" && isRecord(data.lprDossier)) {
    collected.lprDossier = data.lprDossier as MeetingOutput["lprDossier"];
  }
  if (kind === "participants" && Array.isArray(data.participants)) {
    collected.participants = data.participants as MeetingOutput["participants"];
  }
  if (kind === "theses") {
    if (Array.isArray(data.theses)) collected.theses = data.theses as MeetingOutput["theses"];
    if (nonEmpty(data.mainThesis)) collected.mainThesis = (data.mainThesis as string).trim();
  }
  if (kind === "objections" && Array.isArray(data.objections)) {
    collected.objections = data.objections as MeetingOutput["objections"];
  }
  if (kind === "sber") {
    if (Array.isArray(data.sberActions)) collected.sberActions = data.sberActions as MeetingOutput["sberActions"];
    if (nonEmpty(data.proposal)) collected.proposal = (data.proposal as string).trim();
    if (nonEmpty(data.artifact)) collected.artifact = (data.artifact as string).trim();
    if (nonEmpty(data.leaveAfter)) collected.leaveAfter = (data.leaveAfter as string).trim();
  }
  if (kind === "agenda") {
    if (Array.isArray(data.agenda)) collected.agenda = data.agenda as MeetingOutput["agenda"];
    if (isRecord(data.askLadder)) collected.askLadder = data.askLadder as MeetingOutput["askLadder"];
  }
  if (kind === "after") {
    if (isRecord(data.afterMeeting)) collected.afterMeeting = data.afterMeeting as MeetingOutput["afterMeeting"];
    if (Array.isArray(data.ifYes)) collected.ifYes = data.ifYes as MeetingOutput["ifYes"];
    if (Array.isArray(data.ifPause)) collected.ifPause = data.ifPause as MeetingOutput["ifPause"];
    if (Array.isArray(data.ifNo)) collected.ifNo = data.ifNo as MeetingOutput["ifNo"];
  }
}

/** Санитайзер формы: убирает пустые элементы массивов (как в structured-generator). */
export function sanitizeMeetingShape(data: MeetingOutput): MeetingOutput {
  if (Array.isArray(data.agenda)) {
    data.agenda = data.agenda.filter((block) => nonEmpty(block.topic) && nonEmpty(block.sberSays));
  }
  if (Array.isArray(data.objections)) {
    data.objections = data.objections.filter((item) => nonEmpty(item.objection) && nonEmpty(item.response));
  }
  if (Array.isArray(data.theses)) {
    data.theses = data.theses.filter((item) => nonEmpty(item.text));
  }
  if (Array.isArray(data.participants)) {
    data.participants = data.participants.filter((item) => nonEmpty(item.role) && nonEmpty(item.whatMatters));
  }
  return data;
}

export function assembleMeetingBlocks({
  session,
  blocks,
}: {
  session: { meetingGoal?: string; focusTopic?: string };
  blocks: Array<{ kind: MeetingBlockKind; data: unknown }>;
}): MeetingOutput {
  const collected: Partial<MeetingOutput> = {};
  const sources: Source[] = [];
  const hypotheses: string[] = [];

  for (const kind of MEETING_BLOCK_ORDER) {
    const block = blocks.find((item) => item.kind === kind);
    if (!block) continue;
    mergeBlockData(collected, kind, block.data);
    if (isRecord(block.data)) {
      appendSources(sources, block.data.sources);
      appendHypotheses(hypotheses, block.data.hypotheses);
    }
  }

  const meetingGoal =
    collected.meetingGoal || session.meetingGoal || session.focusTopic || "Определить целевой исход встречи";

  const output: MeetingOutput = {
    meetingGoal,
    mainThesis: collected.mainThesis || "",
    leaveAfter: collected.leaveAfter || collected.artifact || "",
    agenda: collected.agenda || [],
    objections: collected.objections || [],
    proposal: collected.proposal || "",
    artifact: collected.artifact || "",
    ifYes: collected.ifYes || [],
    ifPause: collected.ifPause || [],
    ifNo: collected.ifNo || [],
    sberActions: collected.sberActions || [],
    visuals: [],
    askLadder: collected.askLadder,
    ministryPortrait: collected.ministryPortrait,
    lprDossier: collected.lprDossier,
    participants: collected.participants || [],
    theses: collected.theses || [],
    afterMeeting: collected.afterMeeting,
    sources: sources.slice(0, 12),
    hypotheses: hypotheses.slice(0, 8),
  };

  return sanitizeMeetingShape(output);
}

function ministryHasContent(output: MeetingOutput): boolean {
  const p = output.ministryPortrait;
  if (!p) return false;
  return Boolean(
    p.budgetWindow &&
      (nonEmpty(p.budgetWindow.signal) || nonEmpty(p.budgetWindow.tension) || nonEmpty(p.budgetWindow.decision)),
  ) ||
    (p.stats?.length ?? 0) > 0 ||
    (p.initiatives?.length ?? 0) > 0 ||
    (p.incumbents?.length ?? 0) > 0;
}

/**
 * Мягкий гейт готовности (аналог assertRegionOutputReady): meetingGoal непустой,
 * портрет ведомства содержателен И заполнен хотя бы один из agenda/theses/objections.
 * Один пустой опциональный блок не роняет сессию — секция просто скрывается.
 */
export function assertMeetingOutputReady(output: MeetingOutput) {
  const issues: string[] = [];
  if (!nonEmpty(output.meetingGoal)) issues.push("meetingGoal empty");
  if (!ministryHasContent(output)) issues.push("ministryPortrait empty");
  const tacticalBlocks = [
    (output.agenda?.length ?? 0) > 0,
    (output.theses?.length ?? 0) > 0,
    (output.objections?.length ?? 0) > 0,
  ].filter(Boolean).length;
  if (tacticalBlocks < 1) issues.push("no agenda/theses/objections");
  if (issues.length) {
    throw new Error(`Meeting output is not ready: ${issues.join(", ")}`);
  }
}

export function toTypedMeetingOutput(output: MeetingOutput): TypedOutput {
  assertMeetingOutputReady(output);
  return { kind: "meeting", data: output };
}
