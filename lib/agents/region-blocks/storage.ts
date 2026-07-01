import { promises as fs } from "fs";
import path from "path";
import type {
  BlockKind,
  BlockRun,
  BlockState,
  RegionBlocksPlan,
} from "./types";
import type { SessionProfile } from "@/lib/schemas/session";

let stateLockChain: Promise<unknown> = Promise.resolve();
function withStateLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = stateLockChain.then(fn, fn);
  stateLockChain = next.catch(() => undefined);
  return next;
}

function dataRoot() {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}

export function structuredOutputPath(sessionId: string) {
  return path.join(dataRoot(), "structured", `${sessionId}.json`);
}

export function structuredErrorPath(sessionId: string) {
  return path.join(dataRoot(), "structured", `${sessionId}.error.json`);
}

function blocksRoot(sessionId: string) {
  return path.join(dataRoot(), "structured-blocks", sessionId);
}

function runRoot(sessionId: string, runId: string) {
  return path.join(blocksRoot(sessionId), runId);
}

function statePath(sessionId: string, runId: string) {
  return path.join(runRoot(sessionId, runId), "state.json");
}

function currentPath(sessionId: string) {
  return path.join(blocksRoot(sessionId), "current.json");
}

function blockPath(sessionId: string, runId: string, kind: BlockKind) {
  return path.join(runRoot(sessionId, runId), "blocks", `${kind}.json`);
}

export function createRunId() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const random = Math.random().toString(36).slice(2, 8);
  return `run_${stamp}_${random}`;
}

async function atomicWrite(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value), "utf8");
  await fs.rename(tmp, filePath);
}

export async function createBlockRun({
  session,
  plan,
  prompt,
  runId = createRunId(),
}: {
  session: SessionProfile;
  plan: RegionBlocksPlan;
  prompt?: string;
  runId?: string;
}): Promise<BlockRun> {
  const now = new Date().toISOString();
  const run: BlockRun = {
    schemaVersion: 1,
    sessionId: session.id,
    runId,
    taskType: session.taskType as "region_strategy" | "sber_region_strategy",
    prompt,
    region: plan.region,
    status: "planning",
    plan,
    blocks: plan.blocks.map((block) => ({
      kind: block.kind,
      status: "pending",
    })),
    createdAt: now,
    updatedAt: now,
  };

  await fs.mkdir(path.join(runRoot(session.id, runId), "blocks"), { recursive: true });
  await atomicWrite(currentPath(session.id), { runId, updatedAt: now });
  await atomicWrite(statePath(session.id, runId), run);
  return run;
}

export async function readCurrentRunId(sessionId: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(currentPath(sessionId), "utf8");
    const parsed = JSON.parse(raw) as { runId?: string };
    return parsed.runId || null;
  } catch {
    return null;
  }
}

export async function readBlockRun(sessionId: string, runId?: string): Promise<BlockRun | null> {
  const id = runId || await readCurrentRunId(sessionId);
  if (!id) return null;
  try {
    const raw = await fs.readFile(statePath(sessionId, id), "utf8");
    return JSON.parse(raw) as BlockRun;
  } catch {
    return null;
  }
}

export async function writeBlockRun(run: BlockRun): Promise<BlockRun> {
  const next = { ...run, updatedAt: new Date().toISOString() };
  await atomicWrite(statePath(next.sessionId, next.runId), next);
  return next;
}

export async function updateRun(
  run: BlockRun,
  patch: Partial<Omit<BlockRun, "sessionId" | "runId" | "schemaVersion" | "createdAt">>,
): Promise<BlockRun> {
  return withStateLock(async () => {
    const latest = await readBlockRun(run.sessionId, run.runId);
    return writeBlockRun({ ...(latest || run), ...patch });
  });
}

export async function updateBlockState(
  run: BlockRun,
  kind: BlockKind,
  patch: Partial<BlockState>,
): Promise<BlockRun> {
  return withStateLock(async () => {
    const latest = await readBlockRun(run.sessionId, run.runId);
    const source = latest || run;
    const blocks = source.blocks.map((block) =>
      block.kind === kind ? { ...block, ...patch } : block,
    );
    return writeBlockRun({ ...source, blocks });
  });
}

export async function writeBlockData(
  run: BlockRun,
  kind: BlockKind,
  statePatch: Partial<BlockState>,
  data?: unknown,
): Promise<BlockRun> {
  const dataPath = blockPath(run.sessionId, run.runId, kind);
  await atomicWrite(dataPath, {
    kind,
    state: {
      kind,
      status: statePatch.status || "ready",
      ...statePatch,
    },
    data,
    updatedAt: new Date().toISOString(),
  });
  return updateBlockState(run, kind, {
    ...statePatch,
    completedAt: statePatch.status === "ready" ? new Date().toISOString() : statePatch.completedAt,
  });
}

export async function readBlockData(
  sessionId: string,
  runId: string,
  kind: BlockKind,
): Promise<{ state: BlockState; data?: unknown } | null> {
  try {
    const raw = await fs.readFile(blockPath(sessionId, runId, kind), "utf8");
    return JSON.parse(raw) as { state: BlockState; data?: unknown };
  } catch {
    return null;
  }
}

export async function writeStructuredOutput(sessionId: string, output: unknown) {
  await atomicWrite(structuredOutputPath(sessionId), output);
}

export async function writeStructuredError(sessionId: string, error: unknown) {
  await atomicWrite(structuredErrorPath(sessionId), error);
}
