import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import { buildDocx } from "@/lib/export/docx";
import { buildPptx } from "@/lib/export/pptx";
import { buildRegionPdf, toRegionAgentOutput } from "@/lib/export/region-export";
import {
  buildDocModel,
  docTitleFor,
  supportsStructuredDoc,
} from "@/lib/export/structured-doc";
import {
  buildStructuredDocx,
  buildStructuredPdf,
  buildStructuredPptx,
} from "@/lib/export/structured-render";
import { roleLabels, taskLabels } from "@/lib/schemas/session";
import type { TypedOutput } from "@/lib/schemas/structured-output";
import { structuredOutputPath } from "@/lib/agents/region-blocks/storage";
import { getStorage } from "@/lib/storage/local-json-storage";
import { assessTypedOutput } from "@/lib/quality/meeting-output-quality";

export const runtime = "nodejs";

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

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
    if (!sessionId || !SAFE_ID.test(sessionId)) {
      return NextResponse.json({ error: "Invalid sessionId" }, { status: 400 });
    }
    const details = await getStorage().getSession(sessionId);
    if (!details) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    const latest = details.outputs[0];
    let structured: TypedOutput | null = null;
    try {
      structured = JSON.parse(await fs.readFile(structuredOutputPath(sessionId), "utf8")) as TypedOutput;
    } catch {}

    if (!latest && !structured) {
      return NextResponse.json(
        { error: "No materials to export" },
        { status: 400 },
      );
    }
    if (structured) {
      const quality = assessTypedOutput(structured, {
        taskType: details.session.taskType,
      });
      if (!quality.ready) {
        return NextResponse.json(
          {
            error: "Материал не прошёл проверку качества. Пересоберите сессию перед экспортом.",
            quality,
          },
          { status: 409 },
        );
      }
    }
    const meta = [
      roleLabels[details.session.userRole],
      taskLabels[details.session.taskType],
      details.session.region ? `Регион: ${details.session.region}` : "",
      details.session.audience ? `Аудитория: ${details.session.audience}` : "",
    ].filter(Boolean);

    const baseName = transliterate(
      details.session.title?.trim() || latest?.title || "strategy",
    ) || "strategy";

    const pdfHeaders = (name: string) => ({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name}.pdf"`,
      "Cache-Control": "no-store",
    });
    const pptxHeaders = (name: string) => ({
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${name}.pptx"`,
      "Cache-Control": "no-store",
    });
    const docxHeaders = (name: string) => ({
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${name}.docx"`,
      "Cache-Control": "no-store",
    });

    // Регион сохраняет отдельный (проверенный) путь рендера.
    const regionOutput = structured ? toRegionAgentOutput(structured, sessionId) : null;

    // Обобщённый структурированный вывод для встречи / brief / strategy.
    const docModel =
      structured && supportsStructuredDoc(structured)
        ? buildDocModel(structured, docTitleFor(structured, baseName), meta)
        : null;

    // ── PDF ──────────────────────────────────────────────────────────────────
    if (format === "pdf") {
      if (structured?.kind === "region") {
        const bytes = await buildRegionPdf(structured, meta);
        if (bytes) {
          return new NextResponse(Buffer.from(bytes), { status: 200, headers: pdfHeaders(baseName) });
        }
      }
      if (docModel) {
        const bytes = await buildStructuredPdf(docModel);
        return new NextResponse(Buffer.from(bytes), { status: 200, headers: pdfHeaders(baseName) });
      }
      return NextResponse.json(
        { error: "PDF export requires structured session output" },
        { status: 400 },
      );
    }

    // ── PPTX ─────────────────────────────────────────────────────────────────
    if (format === "pptx") {
      if (docModel) {
        const bytes = buildStructuredPptx(docModel);
        return new NextResponse(Buffer.from(bytes), { status: 200, headers: pptxHeaders(baseName) });
      }
      const bytes = buildPptx(regionOutput || latest!, meta);
      return new NextResponse(Buffer.from(bytes), { status: 200, headers: pptxHeaders(baseName) });
    }

    // ── DOCX (по умолчанию) ────────────────────────────────────────────────────
    if (docModel) {
      const bytes = buildStructuredDocx(docModel);
      return new NextResponse(Buffer.from(bytes), { status: 200, headers: docxHeaders(baseName) });
    }
    const bytes = buildDocx(regionOutput || latest!, meta);
    return new NextResponse(Buffer.from(bytes), { status: 200, headers: docxHeaders(baseName) });
  } catch (error) {
    console.error("[export]", error);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
