import { NextResponse } from "next/server";
import path from "path";
import { promises as fs } from "fs";
import { readProgress } from "@/lib/utils/generation-progress";
import { GENERATION_STEPS } from "@/lib/utils/generation-progress";
import { BLOCK_LABELS, BLOCK_ORDER } from "@/lib/agents/region-blocks/types";

export const runtime = "nodejs";

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

function validateId(id: string): boolean {
  return SAFE_ID.test(id) && id.length <= 64;
}

export async function GET(
  _: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await params;
    if (!validateId(sessionId)) {
      return NextResponse.json({ error: "Invalid session ID" }, { status: 400 });
    }

    const resultDir = path.join(
      process.env.DATA_DIR || path.join(process.cwd(), "data"),
      "structured",
    );

    // 1. Full result ready?
    try {
      const fullResult = await fs.readFile(
        path.join(resultDir, `${sessionId}.json`),
        "utf8",
      );
      return NextResponse.json({
        status: "ready",
        sessionId,
        output: JSON.parse(fullResult),
      });
    } catch {}

    // 2. Error?
    try {
      const errorRaw = await fs.readFile(
        path.join(resultDir, `${sessionId}.error.json`),
        "utf8",
      );
      return NextResponse.json({
        status: "error",
        sessionId,
        error: JSON.parse(errorRaw),
      });
    } catch {}

    // 3. Real-time progress
    const progress = await readProgress(sessionId);
    if (progress) {
      const stepKeys = Object.keys(GENERATION_STEPS);
      const currentIdx = stepKeys.indexOf(progress.step);
      const stepWeights = stepKeys.map((k) => GENERATION_STEPS[k].weight);
      const totalWeight = stepWeights.reduce((a, b) => a + b, 0);
      const doneWeight = stepWeights
        .slice(0, currentIdx + 1)
        .reduce((a, b) => a + b, 0);
      const percent = Math.round((doneWeight / totalWeight) * 100);

      // Map progress to block-like visual
      const blocks = BLOCK_ORDER.map((kind, i) => {
        const stepRatio = i / BLOCK_ORDER.length;
        const progressRatio = percent / 100;
        if (progressRatio >= stepRatio + 1 / BLOCK_ORDER.length) {
          return { kind, status: "ready", label: BLOCK_LABELS[kind] };
        }
        if (progressRatio >= stepRatio) {
          return { kind, status: "generating", label: BLOCK_LABELS[kind] };
        }
        return { kind, status: "pending", label: BLOCK_LABELS[kind] };
      });

      const elapsed = (Date.now() - new Date(progress.startedAt).getTime()) / 1000;

      return NextResponse.json({
        status: "generating",
        sessionId,
        progress: {
          step: progress.step,
          message: progress.message,
          percent: Math.min(99, percent),
          elapsed,
        },
        blocks,
      });
    }

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
