import { NextResponse } from "next/server";
import { callCloudEvolution } from "@/lib/integrations/cloud-evolution";
import { callOuroborosEvolution, checkOuroborosA2A } from "@/lib/integrations/ouroboros-client";
import { getRuntimeStatus } from "@/lib/integrations/runtime-status";
import { createFeedbackSchema } from "@/lib/schemas/feedback";
import { getStorage } from "@/lib/storage/local-json-storage";
import { selectRelevantPlaybooks } from "@/lib/agents/prompt-builder";
import { createId } from "@/lib/utils/ids";
import { nowIso } from "@/lib/utils/dates";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const input = createFeedbackSchema.parse(await request.json());
    const storage = getStorage();
    const details = await storage.getSession(input.sessionId);
    const output = await storage.getOutput(input.outputId);
    if (!details || !output) return NextResponse.json({ error: "Session or output not found" }, { status: 404 });
    const feedback = { ...input, id: createId("fb"), createdAt: nowIso() };
    const playbooks = await storage.listPlaybooks();
    const activePlaybooks = selectRelevantPlaybooks(details.session, playbooks);
    const status = getRuntimeStatus();
    if (!status.llm.connected) {
      throw new Error("Cloud.ru Foundation Models не подключен. Ручной запуск evolution требует реальную LLM-модель.");
    }
    const a2aReady =
      status.ouroboros.mode === "a2a" &&
      (await checkOuroborosA2A()
        .then(() => true)
        .catch(() => false));
    const evolutionInput = { sessionProfile: details.session, output, feedback, activePlaybooks };
    const evolution = a2aReady ? await callOuroborosEvolution(evolutionInput) : await callCloudEvolution(evolutionInput);
    return NextResponse.json({ evolution });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Evolution failed" }, { status: 400 });
  }
}
