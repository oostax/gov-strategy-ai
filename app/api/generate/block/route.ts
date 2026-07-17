import { NextResponse } from "next/server";
import { z } from "zod";
import { getStorage } from "@/lib/storage/local-json-storage";
import {
  getMeetingBlocksState,
  regenerateMeetingBlock,
} from "@/lib/agents/meeting-blocks/orchestrator";
import { readMeetingRun } from "@/lib/agents/meeting-blocks/storage";
import {
  MEETING_BLOCK_LABELS,
  MEETING_BLOCK_ORDER,
  type MeetingBlockKind,
} from "@/lib/agents/meeting-blocks/types";
import { logBlockEvent } from "@/lib/agents/region-blocks/logger";
import { canonicalRegionName } from "@/lib/data/region-normalization";
import type { TaskType } from "@/lib/schemas/session";

export const runtime = "nodejs";
// Правка одного блока — синхронный вызов: генерация блока + пересборка output.
// Держим тот же запас времени, что и полная генерация блоков.
export const maxDuration = 600;

const MEETING_TASKS: TaskType[] = ["meeting_preparation", "meeting_followup"];

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;
function validateId(id: string): boolean {
  return SAFE_ID.test(id) && id.length <= 64;
}

const editBlockRequestSchema = z.object({
  sessionId: z.string(),
  blockKind: z.enum(MEETING_BLOCK_ORDER as [MeetingBlockKind, ...MeetingBlockKind[]]),
  // rebuild — обычная пересборка; expand/shorten/recheck — режимы правки объёма/проверки.
  mode: z.enum(["rebuild", "expand", "shorten", "recheck"]).optional().default("rebuild"),
  // Необязательный runId: по умолчанию берём текущий прогон сессии.
  runId: z.string().optional(),
});

async function resolveRegion(session: { region?: string; regionId?: string }) {
  const storage = getStorage();
  if (session.regionId) {
    const byId = await storage.getRegion(session.regionId);
    if (byId) return byId;
  }
  if (session.region) {
    const all = await storage.listRegions();
    const normalized = session.region.trim().toLowerCase();
    const canonical = canonicalRegionName(session.region, all);
    return (
      all.find((item) => item.name.toLowerCase() === normalized) ??
      all.find((item) => item.slug === normalized) ??
      all.find((item) => item.name === canonical) ??
      all.find((item) =>
        normalized.includes(item.slug) || item.name.toLowerCase().includes(normalized),
      ) ??
      null
    );
  }
  return null;
}

/**
 * POST /api/generate/block — правка одного готового блока встречи (волна 8.5).
 * Тело: { sessionId, blockKind, mode?, runId? }. Перезапускает ТОЛЬКО указанный
 * блок и пересобирает материал, не трогая остальные блоки. Возвращает новый
 * статус и, если готово, обновлённый structured output.
 */
export async function POST(request: Request) {
  let sessionIdForLog: string | undefined;
  try {
    const input = editBlockRequestSchema.parse(await request.json());
    sessionIdForLog = input.sessionId;

    if (!validateId(input.sessionId)) {
      return NextResponse.json({ error: "Invalid session ID" }, { status: 400 });
    }

    const storage = getStorage();
    const details = await storage.getSession(input.sessionId);
    if (!details) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const taskType = details.session.taskType;
    if (!MEETING_TASKS.includes(taskType)) {
      return NextResponse.json(
        { error: "Block editing is available only for meeting sessions" },
        { status: 400 },
      );
    }

    // Текущий прогон обязателен: правим уже сгенерированный материал.
    const run = await readMeetingRun(input.sessionId, input.runId);
    if (!run) {
      return NextResponse.json(
        { error: "No generated run to edit. Generate the meeting first." },
        { status: 409 },
      );
    }
    if (!run.plan.blocks.some((b) => b.kind === input.blockKind)) {
      return NextResponse.json(
        { error: `Block "${input.blockKind}" is not part of this material` },
        { status: 400 },
      );
    }

    await logBlockEvent({
      sessionId: input.sessionId,
      runId: run.runId,
      scope: "blocks.api",
      message: "edit_block_start",
      data: { blockKind: input.blockKind, mode: input.mode },
    });

    const region = await resolveRegion(details.session);

    try {
      const { output } = await regenerateMeetingBlock(
        details.session,
        region,
        run,
        input.blockKind,
        input.mode,
      );
      await logBlockEvent({
        sessionId: input.sessionId,
        runId: run.runId,
        scope: "blocks.api",
        message: "edit_block_ready",
        data: { blockKind: input.blockKind, mode: input.mode },
      });
      return NextResponse.json({
        status: "ready",
        sessionId: input.sessionId,
        runId: run.runId,
        blockKind: input.blockKind,
        mode: input.mode,
        label: MEETING_BLOCK_LABELS[input.blockKind],
        output,
      });
    } catch (genError) {
      const message = genError instanceof Error ? genError.message : String(genError);
      console.error(`[block] regenerate failed for ${input.sessionId}/${input.blockKind}:`, message);
      await logBlockEvent({
        sessionId: input.sessionId,
        runId: run.runId,
        scope: "blocks.api",
        message: "edit_block_failed",
        data: { blockKind: input.blockKind, mode: input.mode, error: message },
      });
      // Прежний материал сохранён (regenerateMeetingBlock не затирает данные блока
      // при сбое). Возвращаем текущее состояние, чтобы фронт мог показать его.
      const state = await getMeetingBlocksState(input.sessionId, run.runId).catch(() => null);
      return NextResponse.json(
        {
          status: "error",
          sessionId: input.sessionId,
          runId: run.runId,
          blockKind: input.blockKind,
          error: { message },
          currentStatus: state?.status ?? "ready",
        },
        { status: 502 },
      );
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", issues: error.issues },
        { status: 400 },
      );
    }
    console.error("[block] request failed:", error);
    await logBlockEvent({
      sessionId: sessionIdForLog,
      scope: "blocks.api",
      message: "edit_block_request_failed",
      data: { error: error instanceof Error ? error.message : String(error) },
    });
    return NextResponse.json({ error: "Block regeneration failed" }, { status: 500 });
  }
}
