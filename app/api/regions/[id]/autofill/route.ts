import { NextResponse } from "next/server";
import { buildRegionDraft } from "@/lib/agents/region-autofill";
import { getStorage } from "@/lib/storage/local-json-storage";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Собирает черновик карточки региона из открытых источников и сохраняет его
 * в region.draft. Синхронный: редактор региона показывает спиннер и ждёт ответ.
 */
export async function POST(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const storage = getStorage();
    const region = await storage.getRegion(id);
    if (!region) {
      return NextResponse.json({ error: "Регион не найден" }, { status: 404 });
    }

    const draft = await buildRegionDraft(region.name);
    const updated = await storage.updateRegion(id, { draft });

    return NextResponse.json({ region: updated, draft });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Autofill failed" },
      { status: 500 },
    );
  }
}
