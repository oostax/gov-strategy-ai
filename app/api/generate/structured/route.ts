import { NextResponse } from "next/server";
import { generateStructured } from "@/lib/agents/structured-generator";
import { selectRelevantPlaybooks } from "@/lib/agents/prompt-builder";
import { generateRequestSchema } from "@/lib/schemas/agent";
import { getStorage } from "@/lib/storage/local-json-storage";
import { getMemoryClient } from "@/lib/integrations/mempalace-client";
import {
  formatEvidenceForPrompt,
  retrieveOpenSources,
} from "@/lib/integrations/web-retrieval";
import { promises as fs } from "fs";
import path from "path";
import type { SessionProfile } from "@/lib/schemas/session";

export const runtime = "nodejs";
export const maxDuration = 300;

const cacheDir = path.join(process.cwd(), "data", "structured");

async function resolveRegion(session: { region?: string; regionId?: string }) {
  const storage = getStorage();
  if (session.regionId) {
    const byId = await storage.getRegion(session.regionId);
    if (byId) return byId;
  }
  if (session.region) {
    const all = await storage.listRegions();
    const normalized = session.region.trim().toLowerCase();
    return (
      all.find((item) => item.name.toLowerCase() === normalized) ??
      all.find((item) => item.slug === normalized) ??
      all.find((item) =>
        normalized.includes(item.slug) || item.name.toLowerCase().includes(normalized),
      ) ??
      null
    );
  }
  return null;
}

/**
 * Fire-and-forget генерация.
 * Сразу отвечает 202, запускает генерацию в фоне.
 * Клиент поллит GET /api/sessions/{id} для получения результата.
 */
export async function POST(request: Request) {
  try {
    const input = generateRequestSchema.parse(await request.json());
    const storage = getStorage();
    const details = await storage.getSession(input.sessionId);
    if (!details) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Сбрасываем кэш и ошибку — иначе поллинг сразу вернёт старый результат
    await Promise.all([
      fs.unlink(path.join(cacheDir, `${input.sessionId}.json`)).catch(() => undefined),
      fs.unlink(path.join(cacheDir, `${input.sessionId}.error.json`)).catch(() => undefined),
    ]);

    runGeneration(input.sessionId, input.prompt ?? "", details.session).catch((err) => {
      console.error(`[structured] Background generation failed for ${input.sessionId}:`, err);
    });

    // Сразу отвечаем — клиент будет поллить результат
    return NextResponse.json({ status: "generating", sessionId: input.sessionId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Generation failed" },
      { status: 500 },
    );
  }
}

async function runGeneration(sessionId: string, prompt: string, session: SessionProfile) {
  const errorPath = path.join(cacheDir, `${sessionId}.error.json`);
  try {
    const storage = getStorage();
    const playbooks = await storage.listPlaybooks();
    const activePlaybooks = selectRelevantPlaybooks(session, playbooks);
    const region = await resolveRegion(session);
    const sberCatalog = await storage.listSberCatalog();
    const memories = await getMemoryClient().search(
      `${session.focusTopic ?? ""} ${session.region ?? ""} ${prompt}`,
    );
    const webEvidence = await retrieveOpenSources({
      region: session.region,
      focusTopic: `${session.focusTopic ?? ""} ${prompt}`.trim(),
      limit: 10,
    });

    const result = await generateStructured(
      session,
      activePlaybooks,
      region,
      memories,
      formatEvidenceForPrompt(webEvidence),
      prompt,
      sberCatalog,
    );

    await fs.mkdir(cacheDir, { recursive: true });
    await fs.unlink(errorPath).catch(() => undefined);
    await fs.writeFile(
      path.join(cacheDir, `${sessionId}.json`),
      JSON.stringify(result),
      "utf8",
    );
  } catch (error) {
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(
      errorPath,
      JSON.stringify({
        error: error instanceof Error ? error.message : "Generation failed",
        at: new Date().toISOString(),
      }),
      "utf8",
    );
    throw error;
  }
}
