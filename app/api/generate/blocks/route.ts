import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import { generateRequestSchema } from "@/lib/schemas/agent";
import { getStorage } from "@/lib/storage/local-json-storage";
import { startBlocksGeneration } from "@/lib/agents/region-blocks/orchestrator";
import {
  structuredErrorPath,
  structuredOutputPath,
  writeStructuredError,
} from "@/lib/agents/region-blocks/storage";
import { logBlockEvent } from "@/lib/agents/region-blocks/logger";
import { canonicalRegionName } from "@/lib/data/region-normalization";

export const runtime = "nodejs";
export const maxDuration = 600;

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

function validateId(id: string): boolean {
  return SAFE_ID.test(id) && id.length <= 64;
}

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

export async function POST(request: Request) {
  let sessionIdForLog: string | undefined;
  try {
    const input = generateRequestSchema.parse(await request.json());
    sessionIdForLog = input.sessionId;
    await logBlockEvent({
      sessionId: input.sessionId,
      scope: "blocks.api",
      message: "post_start",
      data: { promptChars: input.prompt?.length || 0 },
    });
    if (!validateId(input.sessionId)) {
      return NextResponse.json({ error: "Invalid session ID" }, { status: 400 });
    }
    const storage = getStorage();
    const details = await storage.getSession(input.sessionId);
    if (!details) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (
      details.session.taskType !== "region_strategy" &&
      details.session.taskType !== "sber_region_strategy"
    ) {
      return NextResponse.json(
        { error: "Block generation is available only for region sessions" },
        { status: 400 },
      );
    }

    const region = await resolveRegion(details.session);
    await Promise.all([
      fs.unlink(structuredErrorPath(input.sessionId)).catch(() => undefined),
      fs.unlink(structuredOutputPath(input.sessionId)).catch(() => undefined),
    ]);
    const { run, promise } = await startBlocksGeneration(details.session, region, input.prompt ?? "");
    await logBlockEvent({
      sessionId: input.sessionId,
      runId: run.runId,
      scope: "blocks.api",
      message: "post_started_run",
      data: { runId: run.runId, region: region?.name || details.session.region || "" },
    });

    promise.catch((err) => {
      console.error(`[blocks] Generation error for ${input.sessionId}:`, err);
      logBlockEvent({
        sessionId: input.sessionId,
        runId: run.runId,
        scope: "blocks.api",
        message: "background_failed",
        data: { error: err instanceof Error ? err.message : String(err) },
      }).catch(() => {});
      writeStructuredError(input.sessionId, {
          error: "Generation failed",
          message: err instanceof Error ? err.message : String(err),
          at: new Date().toISOString(),
      }).catch(() => {});
    });

    return NextResponse.json({
      status: "generating",
      sessionId: input.sessionId,
      runId: run.runId,
    });
  } catch (error) {
    console.error("[blocks] request failed:", error);
    await logBlockEvent({
      sessionId: sessionIdForLog,
      scope: "blocks.api",
      message: "post_failed",
      data: { error: error instanceof Error ? error.message : String(error) },
    });
    return NextResponse.json({ error: "Generation failed" }, { status: 500 });
  }
}
