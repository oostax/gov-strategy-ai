"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export type VoiceState = "idle" | "recording" | "transcribing";

/**
 * Голосовой ввод через MediaRecorder → Cloud.ru Whisper (/api/transcribe).
 * Поддерживает сценарий push-to-talk: start() начинает запись,
 * stop() останавливает и возвращает распознанный текст.
 */
export function useVoiceInput(onTranscribed: (text: string) => void) {
  const [state, setState] = useState<VoiceState>("idle");
  const [supported, setSupported] = useState(true);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const ok =
      typeof navigator !== "undefined" &&
      typeof navigator.mediaDevices?.getUserMedia === "function" &&
      typeof window.MediaRecorder !== "undefined";
    const timer = window.setTimeout(() => setSupported(ok), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const cleanup = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  const start = useCallback(async () => {
    if (!supported || state !== "idle") return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime =
        ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) =>
          MediaRecorder.isTypeSupported(m),
        ) ?? "";
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.start();
      setState("recording");
    } catch (error) {
      cleanup();
      toast.error(
        error instanceof Error
          ? `Не удалось начать запись: ${error.message}`
          : "Микрофон недоступен",
      );
    }
  }, [cleanup, state, supported]);

  const stop = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || state !== "recording") return;
    setState("transcribing");
    const blobPromise = new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        const type = recorder.mimeType || "audio/webm";
        resolve(new Blob(chunksRef.current, { type }));
      };
    });
    recorder.stop();
    try {
      const rawBlob = await blobPromise;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (!rawBlob.size) {
        toast.error("Пустая запись, попробуйте ещё раз");
        setState("idle");
        cleanup();
        return;
      }

      // Конвертируем webm/opus → WAV (Cloud.ru Whisper не принимает webm)
      const wavBlob = await convertToWav(rawBlob);

      const form = new FormData();
      form.append("file", wavBlob, "voice.wav");
      form.append("fileName", "voice.wav");
      form.append("language", "ru");
      const response = await fetch("/api/transcribe", { method: "POST", body: form });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Ошибка сервера: ${response.status}`);
      }
      const data = (await response.json()) as { text?: string; error?: string };
      if (!data.text) {
        throw new Error(data.error || "Не удалось распознать");
      }
      onTranscribed(data.text.trim());
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Ошибка распознавания",
      );
    } finally {
      setState("idle");
      cleanup();
    }
  }, [cleanup, onTranscribed, state]);

  const cancel = useCallback(() => {
    if (recorderRef.current && state === "recording") {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    setState("idle");
    cleanup();
  }, [cleanup, state]);

  return { state, supported, start, stop, cancel };
}

// ── Конвертация webm/opus → WAV ─────────────────────────────────────────────

/**
 * Декодирует аудио-blob через Web Audio API и кодирует в WAV (16-bit PCM).
 * Это нужно потому что Cloud.ru Whisper не принимает webm/opus напрямую.
 */
async function convertToWav(blob: Blob): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioContext = new AudioContext({ sampleRate: 16000 });

  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  } catch {
    // Если не удалось декодировать — отправляем как есть (может быть WAV уже)
    await audioContext.close();
    return blob;
  }

  // Берём первый канал (mono)
  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const numSamples = channelData.length;

  // Кодируем в WAV
  const wavBuffer = encodeWav(channelData, sampleRate);
  await audioContext.close();

  return new Blob([wavBuffer], { type: "audio/wav" });
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const numSamples = samples.length;
  const bytesPerSample = 2; // 16-bit
  const dataSize = numSamples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");

  // fmt chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true); // block align
  view.setUint16(34, 16, true); // bits per sample

  // data chunk
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  // PCM samples
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return buffer;
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
