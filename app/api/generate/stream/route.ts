import { generateStrategyOutput, type GenerationStep } from "@/lib/agents/orchestrator";
import { generateRequestSchema } from "@/lib/schemas/agent";
import { getStorage } from "@/lib/storage/local-json-storage";

export const runtime = "nodejs";
export const maxDuration = 300;

function encodeEvent(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request) {
  const encoder = new TextEncoder();

  let input;
  try {
    input = generateRequestSchema.parse(await request.json());
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        controller.enqueue(encoder.encode(encodeEvent(event, data)));
      }

      try {
        send("step", { step: "storage", message: "Loading session" });
        const details = await getStorage().getSession(input.sessionId);
        if (!details) throw new Error("Session not found");

        const result = await generateStrategyOutput(details.session, input.prompt, async (step: GenerationStep, message: string) => {
          send("step", { step, message });
        });
        send("done", result);
      } catch (error) {
        console.error("[generate/stream]", error);
        send("error", { error: "Generation failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
