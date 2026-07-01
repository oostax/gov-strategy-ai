/**
 * Types for block-by-block region generation.
 * Each block is a self-contained unit with its own search queries,
 * evidence pack, and LLM call. Blocks are assembled into the final
 * RegionAnalysisOutput.
 */

import type {
  RegionSummary,
  IndustryBreakdown,
  BudgetLandscape,
  RegionalScenario,
  Competitor,
  RegionStakeholder,
  Source,
  RegionAnalysisOutput,
} from "@/lib/schemas/structured-output";

// Core thesis type (not exported from main schema)
export interface RegionCoreThesis {
  headline: string;
  surfaceSignal: string;
  hiddenReality: string;
  soWhat: string;
  evidence?: string[];
  sources?: { title: string; url?: string; excerpt: string }[];
}

// ── Block kinds ───────────────────────────────────────────────────────────────

export type BlockKind =
  | "summary"
  | "budget"
  | "industries"
  | "priorities"
  | "scenarios"
  | "competition"
  | "stakeholders";

export const BLOCK_LABELS: Record<BlockKind, string> = {
  summary: "Карточка региона",
  budget: "Бюджетный ландшафт",
  industries: "Отраслевая структура",
  priorities: "Стратегические приоритеты",
  scenarios: "Сценарии развития",
  competition: "Конкурентный ландшафт",
  stakeholders: "Руководители и ведомства",
};

export const BLOCK_ORDER: BlockKind[] = [
  "summary",
  "budget",
  "industries",
  "priorities",
  "scenarios",
  "competition",
  "stakeholders",
];

export const BLOCK_DEPENDENCIES: Partial<Record<BlockKind, BlockKind[]>> = {
  budget: ["summary"],
  industries: ["summary"],
  priorities: ["summary", "budget"],
  scenarios: ["summary", "industries", "budget"],
  competition: ["summary", "industries"],
  stakeholders: ["summary"],
};

// ── Block plan ────────────────────────────────────────────────────────────────

export interface BlockPlan {
  kind: BlockKind;
  label: string;
  searchQueries: string[];
  /** Block kinds that must complete before this one */
  dependsOn: BlockKind[];
}

export interface RegionBlocksPlan {
  sessionId: string;
  region: string;
  focusTopic: string;
  blocks: BlockPlan[];
  createdAt: string;
  /** Адаптивная композиция: тип региона (моногород/дотационный/промышленный/…) */
  archetype?: string;
  /** Одна фраза: на чём держится анализ именно этого региона */
  focusAngle?: string;
  /** Порядок «классических» блоков под архетип (budget/industries/priorities/scenarios/competition/stakeholders) */
  sectionOrder?: BlockKind[];
}

/** «Классические» блоки, порядок которых может адаптироваться под архетип. */
export const CLASSIC_SECTION_KINDS: BlockKind[] = [
  "budget",
  "industries",
  "priorities",
  "scenarios",
  "competition",
  "stakeholders",
];

/** Блоки, которые всегда нужны для сборки (см. assertRegionOutputReady). */
export const CORE_BLOCK_KINDS: BlockKind[] = [
  "summary",
  "budget",
  "industries",
  "priorities",
  "scenarios",
];

/** Блоки, которые можно безопасно не генерировать (не входят в гейт готовности). */
export const OPTIONAL_BLOCK_KINDS: BlockKind[] = ["competition", "stakeholders"];

// ─── Individual block outputs ────────────────────────────────────────────────

export interface SummaryBlockOutput {
  regionSummary: RegionSummary;
  coreThesis?: RegionCoreThesis;
  sources: Source[];
  hypotheses: string[];
}

export interface IndustriesBlockOutput {
  industryBreakdown: IndustryBreakdown[];
  sources: Source[];
  hypotheses: string[];
}

export interface BudgetBlockOutput {
  budgetLandscape: BudgetLandscape;
  sources: Source[];
  hypotheses: string[];
}

export interface ScenariosBlockOutput {
  regionalScenarios: RegionalScenario[];
  sources: Source[];
  hypotheses: string[];
}

export interface CompetitionBlockOutput {
  competitiveLandscape: Competitor[];
  sources: Source[];
  hypotheses: string[];
}

export interface StakeholdersBlockOutput {
  stakeholderMap: RegionStakeholder[];
  sources: Source[];
  hypotheses: string[];
}

export interface PrioritiesBlockOutput {
  strategicPriorities: RegionAnalysisOutput["strategicPriorities"];
  sources: Source[];
  hypotheses: string[];
}

// ── Block deps (shared across all block generators) ──────────────────────────

export interface BlockDeps {
  session: import("@/lib/schemas/session").SessionProfile;
  runId?: string;
  region: string;
  focusTopic: string;
  agentInstructions?: string;
  webEvidence?: string;
  evidencePack?: string;
  collectedSources?: import("@/lib/schemas/structured-output").Source[];
  priorBlocks?: Array<{ kind: BlockKind; data: unknown }>;
  regionContext?: string;
  sberProjectsContext?: string;
}

// ── Block status for API polling ──────────────────────────────────────────────

export type BlockStatus = "pending" | "searching" | "generating" | "ready" | "failed";

export interface BlockState {
  kind: BlockKind;
  status: BlockStatus;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface BlocksGenerationState {
  sessionId: string;
  plan: RegionBlocksPlan;
  blocks: BlockState[];
  createdAt: string;
  /** Full output — set when ALL blocks are assembled */
  assembledOutput?: RegionAnalysisOutput;
}

export interface BlockRun {
  schemaVersion: 1;
  sessionId: string;
  runId: string;
  taskType: "region_strategy" | "sber_region_strategy";
  prompt?: string;
  region: string;
  status: "planning" | "generating" | "assembling" | "ready" | "error";
  plan: RegionBlocksPlan;
  blocks: BlockState[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  outputPath?: string;
  error?: { message: string; blockKind?: BlockKind };
}

// ── Error recovery ──────────────────────────────────────────────────────────

export interface BlockError {
  kind: BlockKind;
  error: string;
  retryable: boolean;
}
