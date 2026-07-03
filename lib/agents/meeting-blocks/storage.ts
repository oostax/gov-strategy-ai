/**
 * Атомарная файловая персистенция прогона встречи и её блоков.
 * Структура повторяет lib/agents/region-blocks/storage.ts, но типизирована под
 * MeetingBlockKind/MeetingBlockRun. Пишет в тот же корень data/structured-blocks/
 * и финальный результат в data/structured/{sessionId}.json (поллинг унифицирован
 * с регионом). Обобщение в blocks-core — следующая фаза.
 */

import { promises as fs } from "fs";
import path from "path";
import type {
  MeetingBlockKind,
  MeetingBlockRun,
  MeetingBlockState,
  MeetingBlocksPlan,
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

function blockPath(sessionId: string, runId: string, kind: MeetingBlockKind) {
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

export async function createMeetingRun({
  session,
  plan,
  prompt,
  runId = createRunId(),
}: {
  session: SessionProfile;
  plan: MeetingBlocksPlan;
  prompt?: string;
  runId?: string;
}): Promise<MeetingBlockRun> {
  const now = new Date().toISOString();
  const run: MeetingBlockRun = {
    schemaVersion: 1,
    sessionId: session.id,
    runId,
    taskType: session.taskType as "meeting_preparation" | "meeting_followup",
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

export async function readMeetingRun(
  sessionId: string,
  runId?: string,
): Promise<MeetingBlockRun | null> {
  const id = runId || (await readCurrentRunId(sessionId));
  if (!id) return null;
  try {
    const raw = await fs.readFile(statePath(sessionId, id), "utf8");
    return JSON.parse(raw) as MeetingBlockRun;
  } catch {
    return null;
  }
}

export async function writeMeetingRun(run: MeetingBlockRun): Promise<MeetingBlockRun> {
  const next = { ...run, updatedAt: new Date().toISOString() };
  await atomicWrite(statePath(next.sessionId, next.runId), next);
  return next;
}

export async function updateRun(
  run: MeetingBlockRun,
  patch: Partial<Omit<MeetingBlockRun, "sessionId" | "runId" | "schemaVersion" | "createdAt">>,
): Promise<MeetingBlockRun> {
  return withStateLock(async () => {
    const latest = await readMeetingRun(run.sessionId, run.runId);
    return writeMeetingRun({ ...(latest || run), ...patch });
  });
}

export async function updateBlockState(
  run: MeetingBlockRun,
  kind: MeetingBlockKind,
  patch: Partial<MeetingBlockState>,
): Promise<MeetingBlockRun> {
  return withStateLock(async () => {
    const latest = await readMeetingRun(run.sessionId, run.runId);
    const source = latest || run;
    const blocks = source.blocks.map((block) =>
      block.kind === kind ? { ...block, ...patch } : block,
    );
    return writeMeetingRun({ ...source, blocks });
  });
}

export async function writeBlockData(
  run: MeetingBlockRun,
  kind: MeetingBlockKind,
  statePatch: Partial<MeetingBlockState>,
  data?: unknown,
): Promise<MeetingBlockRun> {
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
    completedAt:
      statePatch.status === "ready" ? new Date().toISOString() : statePatch.completedAt,
  });
}

export async function readBlockData(
  sessionId: string,
  runId: string,
  kind: MeetingBlockKind,
): Promise<{ state: MeetingBlockState; data?: unknown } | null> {
  try {
    const raw = await fs.readFile(blockPath(sessionId, runId, kind), "utf8");
    return JSON.parse(raw) as { state: MeetingBlockState; data?: unknown };
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
