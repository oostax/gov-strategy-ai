/**
 * Типы поблочной генерации встречи («Подготовка встречи» / «После встречи»).
 * Каждый блок — самостоятельный агент со своим поиском, извлечением фактов и
 * вызовом LLM. Блоки собираются в существующий MeetingOutput (без изменения
 * дашборда). Структура намеренно повторяет lib/agents/region-blocks/types.ts,
 * чтобы orchestrator/storage/evidence были узнаваемы; обобщение в blocks-core —
 * следующая фаза.
 *
 * kind блоков == id реестра lib/schemas/material-plan.ts (meeting_preparation),
 * что даёт прямое отображение «блок → секция дашборда».
 */

import type {
  AskLadder,
  LprDossier,
  MeetingAfter,
  MeetingOutput,
  MeetingParticipant,
  MeetingThesis,
  MinistryPortrait,
  Objection,
  SberAction,
  Source,
} from "@/lib/schemas/structured-output";

// ── Виды блоков встречи ───────────────────────────────────────────────────────

export type MeetingBlockKind =
  | "ministry"
  | "dossier"
  | "participants"
  | "theses"
  | "objections"
  | "sber"
  | "agenda"
  | "after";

export const MEETING_BLOCK_LABELS: Record<MeetingBlockKind, string> = {
  ministry: "Портрет ведомства и повестки",
  dossier: "Досье ЛПР",
  participants: "Карта участников",
  theses: "Тезисы под повестку ЛПР",
  objections: "Возражения",
  sber: "Участие Сбера",
  agenda: "Сценарий встречи",
  after: "После встречи",
};

/** Порядок сборки/волн (по зависимостям). Совпадает с волнами из спецификации. */
export const MEETING_BLOCK_ORDER: MeetingBlockKind[] = [
  "ministry",
  "dossier",
  "participants",
  "theses",
  "objections",
  "sber",
  "agenda",
  "after",
];

export const MEETING_BLOCK_DEPENDENCIES: Partial<
  Record<MeetingBlockKind, MeetingBlockKind[]>
> = {
  dossier: ["ministry"],
  participants: ["ministry"],
  theses: ["ministry", "dossier"],
  objections: ["ministry", "theses"],
  sber: ["ministry", "theses"],
  agenda: ["theses", "objections", "sber"],
  after: ["agenda", "sber"],
};

/** ministry — ядро: генерируется всегда (гейт готовности + зависимость theses). */
export const MEETING_CORE_BLOCK_KINDS: MeetingBlockKind[] = ["ministry"];

/** Ситуативные блоки: их отсутствие не роняет сессию. */
export const MEETING_OPTIONAL_BLOCK_KINDS: MeetingBlockKind[] = [
  "participants",
  "objections",
];

// ── План блоков ───────────────────────────────────────────────────────────────

export interface MeetingBlockPlan {
  kind: MeetingBlockKind;
  label: string;
  searchQueries: string[];
  /** Блоки, которые должны завершиться раньше. */
  dependsOn: MeetingBlockKind[];
  /** true — блок нужен как скрытая зависимость, не рендерится (нет в sectionOrder). */
  hidden?: boolean;
}

export interface MeetingBlocksPlan {
  sessionId: string;
  region: string;
  ministry: string;
  lprName: string;
  lprRole: string;
  focusTopic: string;
  blocks: MeetingBlockPlan[];
  createdAt: string;
  /** Архетип встречи: бюджетная защита / техвнедрение / политический альянс / … */
  archetype?: string;
  /** Одна фраза: на чём держится эта встреча. */
  focusAngle?: string;
  /** Порядок секций для дашборда (id реестра material-plan, включая sources). */
  sectionOrder?: string[];
}

// ── Выходы отдельных блоков ───────────────────────────────────────────────────

export interface MinistryBlockOutput {
  ministryPortrait: MinistryPortrait;
  meetingGoalSeed?: string;
  sources: Source[];
  hypotheses: string[];
}

export interface DossierBlockOutput {
  lprDossier: LprDossier;
  sources: Source[];
  hypotheses: string[];
}

export interface ParticipantsBlockOutput {
  participants: MeetingParticipant[];
  sources: Source[];
  hypotheses: string[];
}

export interface ThesesBlockOutput {
  theses: MeetingThesis[];
  mainThesis?: string;
  sources: Source[];
  hypotheses: string[];
}

export interface ObjectionsBlockOutput {
  objections: Objection[];
  sources: Source[];
  hypotheses: string[];
}

export interface SberBlockOutput {
  sberActions: SberAction[];
  proposal?: string;
  artifact?: string;
  leaveAfter?: string;
  sources: Source[];
  hypotheses: string[];
}

export interface AgendaBlockOutput {
  agenda: MeetingOutput["agenda"];
  askLadder?: AskLadder;
  sources: Source[];
  hypotheses: string[];
}

export interface AfterBlockOutput {
  afterMeeting: MeetingAfter;
  ifYes: MeetingOutput["ifYes"];
  ifPause: MeetingOutput["ifPause"];
  ifNo: MeetingOutput["ifNo"];
  sources: Source[];
  hypotheses: string[];
}

// ── Общий контекст блоков ─────────────────────────────────────────────────────

export interface MeetingBlockDeps {
  session: import("@/lib/schemas/session").SessionProfile;
  runId?: string;
  region: string;
  /** Ведомство (из ввода/фокуса встречи), может быть пустым. */
  ministry: string;
  /** ФИО ЛПР (из meetingWith), может быть пустым — тогда ищем состав руководства. */
  lprName: string;
  lprRole: string;
  focusTopic: string;
  agentInstructions?: string;
  regionContext?: string;
  sberProjectsContext?: string;
  /** Прошлый пользовательский ввод из MemPalace. Это исторический контекст,
   * но НЕ автоматически подтверждённый CRM-факт. */
  memoryContext?: string;
  /** Только явно заполненный внутрисберовский контекст карточки региона:
   * проекты, история взаимодействий, ответственные и заметка. */
  trustedCrmContext?: string;
  /** Готовые блоки предыдущих волн — для контекста (ministry → theses и т.д.). */
  priorBlocks?: Array<{ kind: MeetingBlockKind; data: unknown }>;
  /** Прямая подстановка evidence (используется chat-edit/тестами). */
  webEvidence?: string;
  collectedSources?: Source[];
}

// ── Статусы для поллинга ──────────────────────────────────────────────────────

export type MeetingBlockStatus =
  | "pending"
  | "searching"
  | "generating"
  | "ready"
  | "failed";

export interface MeetingBlockState {
  kind: MeetingBlockKind;
  status: MeetingBlockStatus;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface MeetingBlockRun {
  schemaVersion: 1;
  sessionId: string;
  runId: string;
  taskType: "meeting_preparation" | "meeting_followup";
  prompt?: string;
  region: string;
  status: "planning" | "generating" | "assembling" | "ready" | "error";
  plan: MeetingBlocksPlan;
  blocks: MeetingBlockState[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  outputPath?: string;
  error?: { message: string; blockKind?: MeetingBlockKind };
}
