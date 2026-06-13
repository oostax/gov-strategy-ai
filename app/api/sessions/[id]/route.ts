import { NextResponse } from "next/server";
import { selectRelevantPlaybooks } from "@/lib/agents/prompt-builder";
import { getStorage } from "@/lib/storage/local-json-storage";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await getStorage().getSession(id);
    if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    const playbooks = await getStorage().listPlaybooks();

    // Load structured output if exists
    let structuredOutput = null;
    let generationError: string | null = null;
    try {
      const fs = await import("fs/promises");
      const path = await import("path");
      const base = path.join(process.cwd(), "data", "structured");
      const filePath = path.join(base, `${id}.json`);
      const raw = await fs.readFile(filePath, "utf8");
      structuredOutput = JSON.parse(raw);
    } catch {
      // No cached structured output
    }
    try {
      const fs = await import("fs/promises");
      const path = await import("path");
      const errPath = path.join(process.cwd(), "data", "structured", `${id}.error.json`);
      const errRaw = await fs.readFile(errPath, "utf8");
      const errData = JSON.parse(errRaw) as { error?: string };
      generationError = errData.error ?? null;
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
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await request.json()) as { focusTopic?: string };
    const focusTopic = body.focusTopic?.trim();
    if (!focusTopic) {
      return NextResponse.json({ error: "Укажите новое название сессии" }, { status: 400 });
    }
    const session = await getStorage().renameSession(id, focusTopic);
    return NextResponse.json({ session });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Update failed" }, { status: 400 });
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await getStorage().deleteSession(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Delete failed" }, { status: 400 });
  }
}
