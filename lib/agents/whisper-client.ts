/**
 * Cloud.ru Foundation Models — audio transcription (Whisper-large-v3).
 * Используется для голосового ввода задачи в "Новой сессии".
 */

const DEFAULT_MODEL = "openai/whisper-large-v3";

export interface TranscribeInput {
  file: Blob;
  fileName?: string;
  language?: string; // ISO-код, по умолчанию ru
}

export async function transcribeAudio({
  file,
  fileName = "audio.webm",
  language = "ru",
}: TranscribeInput): Promise<string> {
  const baseUrl =
    process.env.CLOUD_RU_BASE_URL || "https://foundation-models.api.cloud.ru/v1";
  const apiKey = process.env.CLOUD_RU_API_KEY;
  if (!apiKey) {
    throw new Error("CLOUD_RU_API_KEY обязателен для транскрибации");
  }
  const model = process.env.CLOUD_RU_WHISPER_MODEL || DEFAULT_MODEL;

  const form = new FormData();
  form.append("file", file, fileName);
  form.append("model", model);
  form.append("response_format", "text");
  form.append("temperature", "0.2");
  form.append("language", language);

  const response = await fetch(
    `${baseUrl.replace(/\/$/, "")}/audio/transcriptions`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    },
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Transcribe failed: ${response.status} ${errText}`);
  }

  // Cloud.ru может вернуть как plain text, так и JSON с полем "text"
  const raw = await response.text();
  const trimmed = raw.trim();

  // Попробуем распарсить как JSON
  try {
    const parsed = JSON.parse(trimmed) as { text?: string };
    if (typeof parsed.text === "string") {
      return parsed.text.trim();
    }
  } catch {
    // Не JSON — значит plain text, возвращаем как есть
  }

  return trimmed;
}
