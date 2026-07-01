import { NextResponse } from "next/server";
import { selectRelevantPlaybooks } from "@/lib/agents/prompt-builder";
import { getStorage } from "@/lib/storage/local-json-storage";
import { sanitizeRegionOutput } from "@/lib/agents/fact-guard";
import type { RegionAnalysisOutput, TypedOutput } from "@/lib/schemas/structured-output";

export const runtime = "nodejs";

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

function validateId(id: string): boolean {
  return SAFE_ID.test(id) && id.length <= 64;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidStructuredOutput(value: unknown): value is TypedOutput {
  if (!isRecord(value) || typeof value.kind !== "string" || !isRecord(value.data)) return false;
  if ("score" in value.data || "problems" in value.data) return false;

  if (value.kind === "region") {
    return (
      isRecord(value.data.regionSummary) &&
      typeof value.data.regionSummary.name === "string" &&
      Array.isArray(value.data.industryBreakdown) &&
      value.data.industryBreakdown.length > 0 &&
      Array.isArray(value.data.regionalScenarios) &&
      value.data.regionalScenarios.length > 0 &&
      isRecord(value.data.budgetLandscape)
    );
  }

  if (value.kind === "meeting") {
    return typeof value.data.meetingGoal === "string" && Array.isArray(value.data.agenda);
  }

  if (value.kind === "brief") {
    return typeof value.data.decision === "string" && Array.isArray(value.data.evidence);
  }

  if (value.kind === "strategy") {
    return typeof value.data.decision === "string" && Array.isArray(value.data.bets);
  }

  return false;
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!validateId(id)) {
      return NextResponse.json({ error: "Invalid session ID" }, { status: 400 });
    }
    const session = await getStorage().getSession(id);
    if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    const playbooks = await getStorage().listPlaybooks();

    let structuredOutput = null;
    let generationError: string | null = null;
    try {
      const fs = await import("fs/promises");
      const pathMod = await import("path");
      const base = pathMod.join(process.env.DATA_DIR || pathMod.join(process.cwd(), "data"), "structured");
      const filePath = pathMod.join(base, `${id}.json`);
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);
      structuredOutput = isValidStructuredOutput(parsed) ? parsed : null;
      if (structuredOutput && typeof structuredOutput === "object" && structuredOutput.kind === "region") {
        structuredOutput = {
          ...structuredOutput,
          data: sanitizeRegionOutput(structuredOutput.data as RegionAnalysisOutput),
        } as TypedOutput;
      }
    } catch {
      // No cached structured output
    }
    try {
      const fs = await import("fs/promises");
      const pathMod = await import("path");
      const errPath = pathMod.join(process.env.DATA_DIR || pathMod.join(process.cwd(), "data"), "structured", `${id}.error.json`);
      const errRaw = await fs.readFile(errPath, "utf8");
      const errData = JSON.parse(errRaw) as { error?: string };
      if (structuredOutput) {
        await fs.unlink(errPath).catch(() => undefined);
      } else {
        generationError = errData.error ?? null;
      }
    } catch {
      // No generation error file
    }

    return NextResponse.json({
      ...session,
      activePlaybooks: selectRelevantPlaybooks(session.session, playbooks),
      sessions: await getStorage().listSessions(),
      structuredOutput,
      generationError,
    });
  } catch {
    return NextResponse.json({ error: "Failed to load session" }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!validateId(id)) {
      return NextResponse.json({ error: "Invalid session ID" }, { status: 400 });
    }
    const body = (await request.json()) as { focusTopic?: string };
    const focusTopic = body.focusTopic?.trim();
    if (!focusTopic) {
      return NextResponse.json({ error: "Укажите новое название сессии" }, { status: 400 });
    }
    const session = await getStorage().renameSession(id, focusTopic);
    return NextResponse.json({ session });
  } catch {
    return NextResponse.json({ error: "Update failed" }, { status: 400 });
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!validateId(id)) {
      return NextResponse.json({ error: "Invalid session ID" }, { status: 400 });
    }
    await getStorage().deleteSession(id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Delete failed" }, { status: 400 });
  }
}
