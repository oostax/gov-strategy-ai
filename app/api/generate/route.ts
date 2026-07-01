import { NextResponse } from "next/server";
import { generateRequestSchema } from "@/lib/schemas/agent";
import { generateStrategyOutput } from "@/lib/agents/orchestrator";
import { getStorage } from "@/lib/storage/local-json-storage";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(request: Request) {
  try {
    const input = generateRequestSchema.parse(await request.json());
    const details = await getStorage().getSession(input.sessionId);
    if (!details) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    const result = await generateStrategyOutput(details.session, input.prompt);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[generate]", error);
    return NextResponse.json({ error: "Generation failed" }, { status: 500 });
  }
}
