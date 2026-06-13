import { NextResponse } from "next/server";
import { buildDocx } from "@/lib/export/docx";
import { buildPptx } from "@/lib/export/pptx";
import { roleLabels, taskLabels } from "@/lib/schemas/session";
import { getStorage } from "@/lib/storage/local-json-storage";

export const runtime = "nodejs";

function transliterate(text: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z",
    и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
    с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh",
    щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  return text
    .toLowerCase()
    .split("")
    .map((c) => map[c] ?? c)
    .join("")
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId");
    const format = (url.searchParams.get("format") || "docx").toLowerCase();
    if (!sessionId) {
      return NextResponse.json({ error: "sessionId обязателен" }, { status: 400 });
    }
    const details = await getStorage().getSession(sessionId);
    if (!details) {
      return NextResponse.json({ error: "Сессия не найдена" }, { status: 404 });
    }
    const latest = details.outputs[0];
    if (!latest) {
      return NextResponse.json(
        { error: "В сессии ещё нет материалов для экспорта" },
        { status: 400 },
      );
    }
    const meta = [
      roleLabels[details.session.userRole],
      taskLabels[details.session.taskType],
      details.session.region ? `Регион: ${details.session.region}` : "",
      details.session.audience ? `Для: ${details.session.audience}` : "",
    ].filter(Boolean);

    const baseName = transliterate(
      details.session.title?.trim() || latest.title || "strategy",
    ) || "strategy";

    if (format === "pptx") {
      const bytes = buildPptx(latest, meta);
      return new NextResponse(Buffer.from(bytes), {
        status: 200,
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          "Content-Disposition": `attachment; filename="${baseName}.pptx"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const bytes = buildDocx(latest, meta);
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${baseName}.docx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Export failed" },
      { status: 500 },
    );
  }
}
