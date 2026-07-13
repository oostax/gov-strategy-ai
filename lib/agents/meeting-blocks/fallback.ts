/**
 * Безопасный фолбэк: если блочный пайплайн встречи упал целиком, собираем
 * материал существующей одноходовой generateStructured — пользователь не
 * остаётся без результата. Пишем в тот же structuredOutputPath, что и блоки,
 * поэтому поллинг результата не меняется.
 */

import type { SessionProfile } from "@/lib/schemas/session";
import type { RegionProfile } from "@/lib/schemas/region";
import { generateStructured } from "@/lib/agents/structured-generator";
import { selectRelevantPlaybooks } from "@/lib/agents/prompt-builder";
import { getStorage } from "@/lib/storage/local-json-storage";
import { getMemoryClient } from "@/lib/integrations/mempalace-client";
import {
  formatEvidenceForPrompt,
  retrieveOpenSources,
} from "@/lib/integrations/web-retrieval";
import {
  readMeetingRun,
  structuredOutputPath,
  updateRun,
  writeStructuredOutput,
} from "./storage";
import { toTypedMeetingOutput } from "./assembler";
import { canUseAsHistoricalUserInput } from "@/lib/quality/memory-provenance";

export async function runMeetingSingleShotFallback(
  session: SessionProfile,
  region: RegionProfile | null,
  prompt: string,
): Promise<void> {
  const storage = getStorage();
  const playbooks = await storage.listPlaybooks();
  const activePlaybooks = selectRelevantPlaybooks(session, playbooks);
  const sberCatalog = await storage.listSberCatalog().catch(() => []);
  const memories = (await getMemoryClient()
    .search(`${session.focusTopic ?? ""} ${session.region ?? ""} ${prompt}`)
    .catch(() => []))
    .filter((hit) => canUseAsHistoricalUserInput(hit.sourceFile));
  const webEvidence = await retrieveOpenSources({
    region: session.region,
    focusTopic: `${session.focusTopic ?? ""} ${prompt}`.trim(),
    limit: 10,
  }).catch(() => []);

  const output = await generateStructured(
    session,
    activePlaybooks,
    region,
    memories,
    formatEvidenceForPrompt(webEvidence),
    prompt,
    sberCatalog,
  );

  if (output.kind !== "meeting") {
    throw new Error(`Meeting fallback returned unexpected output kind: ${output.kind}`);
  }
  const validated = toTypedMeetingOutput(output.data, session.taskType);
  await writeStructuredOutput(session.id, validated);

  // Приводим прогон в состояние "ready", чтобы поллинг отдал одноходовой
  // результат, а не завис на статусе "error"/"assembling" от упавших блоков.
  try {
    const run = await readMeetingRun(session.id);
    if (run) {
      await updateRun(run, {
        status: "ready",
        completedAt: new Date().toISOString(),
        outputPath: structuredOutputPath(session.id),
        error: undefined,
      });
    }
  } catch {
    // Поллинг всё равно прочитает файл результата как запасной путь.
  }
}
