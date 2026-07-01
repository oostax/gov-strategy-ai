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
    console.error("[action]", error);
    return NextResponse.json({ error: "Action failed" }, { status: 500 });
  }
}
