import { NextResponse } from "next/server";
import { runInteractiveAction } from "@/lib/agents/orchestrator";
import { actionRequestSchema } from "@/lib/schemas/agent";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const input = actionRequestSchema.parse(await request.json());
    const result = await runInteractiveAction(input);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Action failed" }, { status: 400 });
  }
}
