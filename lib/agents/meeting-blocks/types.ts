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

/**
 * Режим правки одного готового блока (волна 8.5, «правки кнопками»).
 * - rebuild  — обычная пересборка блока (генератор с теми же deps/priorBlocks).
 * - expand   — тот же блок, но глубже/подробнее (больше пунктов, детализация).
 * - shorten  — тот же блок, но короче/суше (оставить суть, убрать воду).
 * - recheck  — перепроверить факты/тиеры, ужесточить дисциплину источников.
 * - undo     — вернуть предыдущую версию блока из стека версий прогона,
 *              БЕЗ вызова LLM (см. restoreMeetingBlock в orchestrator.ts).
 */
export type MeetingBlockMode = "rebuild" | "expand" | "shorten" | "recheck" | "undo";

/**
 * Директивы режимов правки — добавляются в промпт блока (не меняют схему JSON).
 * "undo" сюда не входит: этот режим не идёт в LLM, а восстанавливает снапшот
 * блока из стека версий.
 */
export const MEETING_BLOCK_MODE_DIRECTIVES: Record<
  Exclude<MeetingBlockMode, "rebuild" | "undo">,
  string
> = {
  expand:
    "РЕЖИМ ПРАВКИ: РАСШИРИТЬ. Дай более глубокую и подробную версию этого блока: " +
    "используй верхнюю границу количества элементов, добавь конкретики и деталей к каждому пункту, " +
    "раскрой нюансы. НЕ меняй структуру JSON и не выдумывай факты — новое наполняй как hypothesis/ask, " +
    "если нет источника. Тиерная дисциплина сохраняется.",
  shorten:
    "РЕЖИМ ПРАВКИ: СОКРАТИТЬ. Дай более короткую и сухую версию этого блока: " +
    "оставь только самое важное, используй нижнюю границу количества элементов, убери воду и повторы, " +
    "формулировки делай плотнее. НЕ меняй структуру JSON и сохраняй тиерную дисциплину.",
  recheck:
    "РЕЖИМ ПРАВКИ: ПЕРЕПРОВЕРИТЬ. Критически перепроверь этот блок: " +
    "каждый tier=\"fact\" должен иметь реальный source с url из блока источников — иначе понизь до hypothesis; " +
    "убери недоказанные цифры, суммы и проценты (вынеси как ask или дай формулу с нужным baseline); " +
    "сохрани только подтверждённое. НЕ меняй структуру JSON.",
};

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
  /**
   * Директива правки одного блока (волна 8.5): расширить / сократить /
   * перепроверить, и/или свободная инструкция руководителя (чат-правка).
   * Подмешивается в userMessage блока через buildContextPreamble. Пусто при
   * обычной (пере)генерации. Не меняет структуру JSON блока и не отменяет
   * тиерную дисциплину — свободная инструкция явно требует не выдумывать факты.
   */
  modeDirective?: string;
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
