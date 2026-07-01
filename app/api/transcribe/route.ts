import { NextResponse } from "next/server";
import { transcribeAudio } from "@/lib/agents/whisper-client";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) {
      return NextResponse.json(
        { error: "Invalid audio file" },
        { status: 400 },
      );
    }
    if (file.size === 0) {
      return NextResponse.json(
        { error: "Empty recording" },
        { status: 400 },
      );
    }
    if (file.size > 25 * 1024 * 1024) {
      return NextResponse.json(
        { error: "File too large (max 25MB)" },
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
        { error: "Could not recognize speech" },
        { status: 400 },
      );
    }
    return NextResponse.json({ text });
  } catch (error) {
    console.error("[transcribe]", error);
    return NextResponse.json({ error: "Transcription failed" }, { status: 500 });
  }
}
