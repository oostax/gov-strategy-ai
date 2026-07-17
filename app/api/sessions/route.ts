import { NextResponse } from "next/server";
import { getMemoryClient } from "@/lib/integrations/mempalace-client";
import { createSessionSchema } from "@/lib/schemas/session";
import { getStorage } from "@/lib/storage/local-json-storage";
import { ensureRegionForSession } from "@/lib/storage/region-resolver";
import { buildRegionDraft } from "@/lib/agents/region-autofill";

export const runtime = "nodejs";

async function autofillRegionInBackground(regionId: string, regionName: string) {
  const storage = getStorage();
  try {
    await storage.updateRegion(regionId, {
      draft: {
        generatedAt: new Date().toISOString(),
        status: "generating",
        sources: [],
        topPriorities: [],
        painPoints: [],
        news: [],
        stakeholders: [],
      },
    });
    const draft = await buildRegionDraft(regionName);
    await storage.updateRegion(regionId, { draft });
  } catch (err) {
    console.error(`[sessions] autofill region ${regionId} failed:`, err);
    await storage
      .updateRegion(regionId, {
        draft: {
          generatedAt: new Date().toISOString(),
          status: "ready",
          sources: [],
          topPriorities: [],
          painPoints: [],
          news: [],
          stakeholders: [],
        },
      })
      .catch(() => undefined);
  }
}

export async function GET() {
  try {
    const sessions = await getStorage().listSessions();
    return NextResponse.json({ sessions });
  } catch {
    return NextResponse.json({ error: "Failed to list sessions" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = createSessionSchema.parse(body);
    const { input: withRegion, createdRegionId } = await ensureRegionForSession(input);
    const session = await getStorage().createSession(withRegion);
    // Запись в MemPalace — BEST-EFFORT. Раньше её сбой удалял уже созданную
    // сессию и возвращал 500 ("Failed to create session"): падение/зависание
    // MemPalace полностью ломало создание сессий и приводило к "исчезновению"
    // только что созданной сессии. Память не критична для создания — логируем
    // и продолжаем, сессия сохраняется.
    void getMemoryClient()
      .rememberSession(session)
      .catch((error) =>
        console.warn(
          `[sessions] rememberSession пропущена (MemPalace): ${error instanceof Error ? error.message : error}`,
        ),
      );

    if (createdRegionId) {
      void autofillRegionInBackground(createdRegionId, withRegion.region ?? "");
    }

    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    console.error("[sessions] create failed:", error);
    return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
  }
}
