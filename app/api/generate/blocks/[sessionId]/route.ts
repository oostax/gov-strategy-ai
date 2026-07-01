import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import { getBlocksState } from "@/lib/agents/region-blocks/orchestrator";
import { BLOCK_LABELS, BLOCK_ORDER } from "@/lib/agents/region-blocks/types";
import {
  structuredErrorPath,
  structuredOutputPath,
} from "@/lib/agents/region-blocks/storage";

export const runtime = "nodejs";

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

function validateId(id: string): boolean {
  return SAFE_ID.test(id) && id.length <= 64;
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

    const state = await getBlocksState(sessionId, runId);
    if (state) {
      const blocks = BLOCK_ORDER.map((kind) => {
        const bs = state.blocks.find((b) => b.kind === kind);
        const ready = state.readyBlocks.find((r) => r.kind === kind);
        return {
          kind,
          status: bs?.status || "pending",
          label: BLOCK_LABELS[kind],
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
      const total = BLOCK_ORDER.length;
      return NextResponse.json({
        status: "generating",
        sessionId,
        runId: state.runId,
        blocks,
        progress: {
          step: `block_${readyCount}_of_${total}`,
          message: readyCount > 0
            ? `Сгенерировано ${readyCount} из ${total} блоков`
            : "Запуск генерации блоков...",
          percent: Math.round((readyCount / total) * 100),
          elapsed: 0,
        },
      });
    }

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
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to check generation status" },
      { status: 500 },
    );
  }
}
