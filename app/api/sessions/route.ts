import { NextResponse } from "next/server";
import { getMemoryClient } from "@/lib/integrations/mempalace-client";
import { createSessionSchema } from "@/lib/schemas/session";
import { getStorage } from "@/lib/storage/local-json-storage";
import { ensureRegionForSession } from "@/lib/storage/region-resolver";
import { buildRegionDraft } from "@/lib/agents/region-autofill";

export const runtime = "nodejs";

/**
 * Фоновое автозаполнение карточки нового региона. Сначала помечает черновик как
 * «generating» (чтобы редактор региона сразу показал спиннер), затем собирает
 * данные из открытых источников и сохраняет. Ошибки только логируются.
 */
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
    console.error(`[sessions] автозаполнение региона ${regionId} не удалось:`, err);
    // Снимаем статус «generating», чтобы UI не висел в загрузке.
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
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = createSessionSchema.parse(body);
    // Привязываем сессию к региону справочника: находим существующий или
    // создаём новый — иначе региональный контекст не подтягивается в генерацию.
    const { input: withRegion, createdRegionId } = await ensureRegionForSession(input);
    const session = await getStorage().createSession(withRegion);
    try {
      await getMemoryClient().rememberSession(session);
    } catch (error) {
      await getStorage().deleteSession(session.id);
      throw error;
    }

    // Для только что созданного региона запускаем автозаполнение карточки в фоне
    // (fire-and-forget): создание сессии не ждёт веб-поиск и LLM.
    if (createdRegionId) {
      void autofillRegionInBackground(createdRegionId, withRegion.region ?? "");
    }

    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status: 400 });
  }
}
