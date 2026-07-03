import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import { getBlocksState } from "@/lib/agents/region-blocks/orchestrator";
import { getMeetingBlocksState } from "@/lib/agents/meeting-blocks/orchestrator";
import { BLOCK_LABELS, BLOCK_ORDER } from "@/lib/agents/region-blocks/types";
import { MEETING_BLOCK_LABELS, MEETING_BLOCK_ORDER } from "@/lib/agents/meeting-blocks/types";
import { readMeetingRun } from "@/lib/agents/meeting-blocks/storage";
import {
  structuredErrorPath,
  structuredOutputPath,
} from "@/lib/agents/region-blocks/storage";

export const runtime = "nodejs";

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

function validateId(id: string): boolean {
  return SAFE_ID.test(id) && id.length <= 64;
}

const MEETING_TASKS = new Set(["meeting_preparation", "meeting_followup"]);

/**
 * Универсальная выборка состояния прогона по домену. Раннеры региона и встречи
 * пишут state.json в один корень; различаем по taskType прогона и берём
 * labels/order из соответствующего реестра. Прогресс считается по реально
 * запланированным блокам.
 */
async function loadDomainState(sessionId: string, runId?: string) {
  // Сначала пробуем определить домен по taskType прогона (state.json общий).
  const meetingRun = await readMeetingRun(sessionId, runId).catch(() => null);
  const isMeeting = meetingRun ? MEETING_TASKS.has(meetingRun.taskType) : false;

  if (isMeeting) {
    const state = await getMeetingBlocksState(sessionId, runId);
    if (!state) return null;
    return {
      state,
      labels: MEETING_BLOCK_LABELS as Record<string, string>,
      defaultOrder: MEETING_BLOCK_ORDER as readonly string[],
    };
  }

  const state = await getBlocksState(sessionId, runId);
  if (!state) return null;
  return {
    state,
    labels: BLOCK_LABELS as Record<string, string>,
    defaultOrder: BLOCK_ORDER as readonly string[],
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await params;
    if (!validateId(sessionId)) {
      return NextResponse.json({ error: "Invalid session ID" }, { status: 400 });
    }

    const url = new URL(request.url);
    const runId = url.searchParams.get("runId") || undefined;

    const domain = await loadDomainState(sessionId, runId);
    if (domain) {
      const { state, labels, defaultOrder } = domain;
      // Показываем прогресс по реально запланированным блокам, а не по всем возможным.
      const plannedKinds: string[] = state.plan?.blocks?.length
        ? state.plan.blocks.map((b) => b.kind)
        : [...defaultOrder];
      const blocks = plannedKinds.map((kind) => {
        const bs = state.blocks.find((b) => b.kind === kind);
        const ready = state.readyBlocks.find((r) => r.kind === kind);
        return {
          kind,
          status: bs?.status || "pending",
          label: labels[kind] ?? kind,
          data: ready?.data || null,
          error: bs?.error,
        };
      });

      if (state.status === "ready") {
        try {
          const fullResult = await fs.readFile(structuredOutputPath(sessionId), "utf8");
          return NextResponse.json({
            status: "ready",
            sessionId,
            runId: state.runId,
            output: JSON.parse(fullResult),
            blocks,
          });
        } catch (error) {
          return NextResponse.json({
            status: "error",
            sessionId,
            runId: state.runId,
            error: {
              message: error instanceof Error ? error.message : "Result file is not available",
            },
            blocks,
          });
        }
      }

      if (state.status === "error") {
        return NextResponse.json({
          status: "error",
          sessionId,
          runId: state.runId,
          error: state.error || { message: "Generation failed" },
          blocks,
        });
      }

      const readyCount = blocks.filter((block) => block.status === "ready").length;
      const total = plannedKinds.length;
      return NextResponse.json({
        status: "generating",
        sessionId,
        runId: state.runId,
        blocks,
        progress: {
          step: `block_${readyCount}_of_${total}`,
          message:
            readyCount > 0
              ? `Сгенерировано ${readyCount} из ${total} блоков`
              : "Запуск генерации блоков...",
          percent: total > 0 ? Math.round((readyCount / total) * 100) : 0,
          elapsed: 0,
        },
      });
    }

    // Прогона нет в state — но результат/ошибка могли быть записаны (в т.ч. фолбэком).
    try {
      const fullResult = await fs.readFile(structuredOutputPath(sessionId), "utf8");
      return NextResponse.json({
        status: "ready",
        sessionId,
        output: JSON.parse(fullResult),
      });
    } catch {}

    try {
      const errorRaw = await fs.readFile(structuredErrorPath(sessionId), "utf8");
      return NextResponse.json({
        status: "error",
        sessionId,
        error: JSON.parse(errorRaw),
      });
    } catch {}

    return NextResponse.json({
      status: "generating",
      sessionId,
      progress: {
        step: "starting",
        message: "Запуск генерации...",
        percent: 0,
        elapsed: 0,
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to check generation status" },
      { status: 500 },
    );
  }
}
