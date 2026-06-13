import type { Feedback } from "@/lib/schemas/feedback";
import type { AgentOutput } from "@/lib/schemas/output";
import type { EvolutionResult, Playbook, PlaybookHistory, UpdatePlaybookInput } from "@/lib/schemas/playbook";
import type {
  CreateRegionInput,
  RegionProfile,
  UpdateRegionInput,
} from "@/lib/schemas/region";
import type { CreateSessionInput, SessionProfile } from "@/lib/schemas/session";
import type {
  CreateSberGovProjectInput,
  SberGovProject,
  UpdateSberGovProjectInput,
} from "./sber-projects";

export interface SessionDetails {
  session: SessionProfile;
  outputs: AgentOutput[];
  feedback: Feedback[];
  evolution: EvolutionRecord[];
}

export interface EvolutionRecord {
  id: string;
  sessionId: string;
  outputId: string;
  result: EvolutionResult;
  createdAt: string;
}

/** Провенанс обучения для записи истории playbook (см. playbookHistorySchema). */
export type PlaybookHistoryMeta = Pick<
  PlaybookHistory,
  "direction" | "rating" | "sessionId" | "rule"
>;

export interface StorageAdapter {
  createSession(input: CreateSessionInput): Promise<SessionProfile>;
  listSessions(): Promise<SessionProfile[]>;
  getSession(id: string): Promise<SessionDetails | null>;
  getSessionByShareToken(token: string): Promise<SessionDetails | null>;
  updateSession(session: SessionProfile): Promise<SessionProfile>;
  renameSession(id: string, focusTopic: string): Promise<SessionProfile>;
  rotateShareToken(id: string, enable: boolean): Promise<SessionProfile>;
  deleteSession(id: string): Promise<void>;
  saveOutput(output: AgentOutput): Promise<AgentOutput>;
  getOutput(id: string): Promise<AgentOutput | null>;
  listOutputs(sessionId?: string): Promise<AgentOutput[]>;
  saveFeedback(feedback: Feedback): Promise<Feedback>;
  listFeedback(sessionId?: string): Promise<Feedback[]>;
  saveEvolution(record: EvolutionRecord): Promise<EvolutionRecord>;
  listEvolution(sessionId?: string): Promise<EvolutionRecord[]>;
  listPlaybooks(): Promise<Playbook[]>;
  getPlaybook(idOrSlug: string): Promise<Playbook | null>;
  updatePlaybook(
    idOrSlug: string,
    input: UpdatePlaybookInput,
    change: string,
    meta?: PlaybookHistoryMeta,
  ): Promise<Playbook>;

  // ── Регионы и портфель Сбера ─────────────────────────────────────────────
  listRegions(): Promise<RegionProfile[]>;
  getRegion(idOrSlug: string): Promise<RegionProfile | null>;
  createRegion(input: CreateRegionInput): Promise<RegionProfile>;
  updateRegion(idOrSlug: string, input: UpdateRegionInput): Promise<RegionProfile>;
  deleteRegion(idOrSlug: string): Promise<void>;

  // ── Каталог проектов Сбера (редактируемый) ───────────────────────────────
  listSberCatalog(): Promise<SberGovProject[]>;
  createSberCatalogProject(input: CreateSberGovProjectInput): Promise<SberGovProject>;
  updateSberCatalogProject(id: string, input: UpdateSberGovProjectInput): Promise<SberGovProject>;
  deleteSberCatalogProject(id: string): Promise<void>;
}
