import { promises as fs } from "fs";
import path from "path";

function dataRoot() {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}

export async function logBlockEvent({
  sessionId,
  runId,
  scope,
  message,
  data,
}: {
  sessionId?: string;
  runId?: string;
  scope: string;
  message: string;
  data?: Record<string, unknown>;
}) {
  const event = {
    at: new Date().toISOString(),
    scope,
    message,
    ...(data ? { data } : {}),
  };
  const line = JSON.stringify(event);
  console.log(`[${scope}] ${message}`, data || "");

  if (!sessionId) return;
  try {
    const filePath = runId
      ? path.join(dataRoot(), "structured-blocks", sessionId, runId, "events.jsonl")
      : path.join(dataRoot(), "structured-blocks", sessionId, "events.jsonl");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, `${line}\n`, "utf8");
  } catch (error) {
    console.warn("[blocks][log] failed to write event:", error);
  }
}
