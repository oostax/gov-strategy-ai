import { NextResponse } from "next/server";
import { transcribeAudio } from "@/lib/agents/whisper-client";

export const runtime = "nodejs";
export const maxDuration = 60;

// Увеличиваем лимит body для аудиофайлов (до 25MB)
export const config = {
  api: { bodyParser: false },
};

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) {
      return NextResponse.json(
        { error: "Пустой или некорректный аудиофайл" },
        { status: 400 },
      );
    }
    if (file.size === 0) {
      return NextResponse.json(
        { error: "Пустая запись — попробуйте ещё раз" },
        { status: 400 },
      );
    }
    if (file.size > 25 * 1024 * 1024) {
      return NextResponse.json(
        { error: "Файл слишком большой (макс. 25MB)" },
        { status: 400 },
      );
    }
    const languageRaw = form.get("language");
    const language = typeof languageRaw === "string" ? languageRaw : "ru";
    const fileNameRaw = form.get("fileName");
    const fileName = typeof fileNameRaw === "string" ? fileNameRaw : "audio.webm";
    const text = await transcribeAudio({ file, fileName, language });
    if (!text) {
      return NextResponse.json(
        { error: "Не удалось распознать речь — попробуйте говорить громче" },
        { status: 400 },
      );
    }
    return NextResponse.json({ text });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transcribe error";
    console.error("[transcribe] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
