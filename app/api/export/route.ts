import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import { buildDocx } from "@/lib/export/docx";
import { buildPptx } from "@/lib/export/pptx";
import { buildRegionPdf, toRegionAgentOutput } from "@/lib/export/region-export";
import { roleLabels, taskLabels } from "@/lib/schemas/session";
import type { TypedOutput } from "@/lib/schemas/structured-output";
import { structuredOutputPath } from "@/lib/agents/region-blocks/storage";
import { getStorage } from "@/lib/storage/local-json-storage";

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
    const meta = [
      roleLabels[details.session.userRole],
      taskLabels[details.session.taskType],
      details.session.region ? `Region: ${details.session.region}` : "",
      details.session.audience ? `For: ${details.session.audience}` : "",
    ].filter(Boolean);

    const baseName = transliterate(
      details.session.title?.trim() || latest?.title || "strategy",
    ) || "strategy";

    const regionOutput = structured ? toRegionAgentOutput(structured, sessionId) : null;

    if (format === "pdf" && structured) {
      const bytes = await buildRegionPdf(structured, meta);
      if (bytes) {
        return new NextResponse(Buffer.from(bytes), {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${baseName}.pdf"`,
            "Cache-Control": "no-store",
          },
        });
      }
    }
    if (format === "pdf") {
      return NextResponse.json(
        { error: "PDF export is available for structured region sessions" },
        { status: 400 },
      );
    }

    if (format === "pptx") {
      const bytes = buildPptx(regionOutput || latest!, meta);
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

    const bytes = buildDocx(regionOutput || latest!, meta);
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
    console.error("[export]", error);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
