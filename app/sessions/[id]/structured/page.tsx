"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { StructuredDashboard } from "@/components/strategy/structured/structured-dashboard";
import { FeedbackWidget } from "@/components/strategy/structured/feedback-widget";
import { SessionToolbar } from "@/components/strategy/session-toolbar";
import type { TypedOutput } from "@/lib/schemas/structured-output";
import type { SessionProfile } from "@/lib/schemas/session";

export default function StructuredSessionPage() {
  const params = useParams<{ id: string }>();
  const sessionId = params.id;

  const [session, setSession] = useState<SessionProfile | null>(null);
  const [output, setOutput] = useState<TypedOutput | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/sessions/${sessionId}`)
      .then((r) => r.json())
      .then((data: { session?: SessionProfile; structuredOutput?: TypedOutput | null }) => {
        if (data.session) setSession(data.session);
        if (data.structuredOutput) setOutput(data.structuredOutput);
      })
      .finally(() => setInitialLoading(false));
  }, [sessionId]);

  async function generate(prompt = "") {
    setLoading(true);
    try {
      // Генерация fire-and-forget: сервер отвечает сразу и считает в фоне.
      const response = await fetch("/api/generate/structured", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, prompt }),
      });
      const data = (await response.json()) as {
        status?: string;
        output?: TypedOutput;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || "Генерация не удалась");
      }
      // Если результат вернулся сразу — показываем; иначе поллим GET-эндпоинт.
      if (data.output) {
        setOutput(data.output);
        toast.success("Материал сформирован");
        return;
      }
      await pollForResult();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка генерации");
      setLoading(false);
    }
  }

  // Поллим GET /api/sessions/{id}, пока не появится structuredOutput или generationError.
  async function pollForResult() {
    const maxAttempts = 90; // ~3 мин при интервале 2с
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const r = await fetch(`/api/sessions/${sessionId}`);
        const d = (await r.json()) as {
          structuredOutput?: TypedOutput | null;
          generationError?: string | null;
        };
        if (d.generationError) {
          throw new Error(d.generationError);
        }
        if (d.structuredOutput) {
          setOutput(d.structuredOutput);
          toast.success("Материал сформирован");
          setLoading(false);
          return;
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Ошибка генерации");
        setLoading(false);
        return;
      }
    }
    toast.error("Генерация заняла слишком много времени. Попробуйте пересобрать.");
    setLoading(false);
  }

  if (initialLoading) {
    return (
      <AppShell>
        <div className="flex min-h-96 items-center justify-center">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-4">
        {session && (
          <SessionToolbar
            session={session}
            onRenamed={(s) => setSession(s)}
          />
        )}

        {/* Generate button */}
        <div className="flex items-center justify-between gap-3 rounded-2xl border bg-card px-4 py-3">
          <div>
            <p className="text-sm font-semibold">
              {output ? "Пересобрать материал" : "Сформировать материал"}
            </p>
            <p className="text-xs text-muted-foreground">
              Structured output · gpt-oss-120b · ~2 мин
            </p>
          </div>
          <Button onClick={() => generate()} disabled={loading}>
            {loading ? (
              <RefreshCw className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {loading ? "Генерирую..." : output ? "Пересобрать" : "Сформировать"}
          </Button>
        </div>

        {/* Output */}
        {output && <StructuredDashboard output={output} />}

        {/* Оценка → эволюция: обучает агента и обновляет правила */}
        {output && !loading && (
          <FeedbackWidget
            sessionId={sessionId}
            onEvolved={() => {
              toast.success("Правила обновлены — пересобираю материал");
              generate();
            }}
          />
        )}

        {!output && !loading && (
          <div className="flex min-h-80 items-center justify-center rounded-2xl border border-dashed">
            <div className="text-center">
              <Sparkles className="mx-auto mb-3 size-8 text-muted-foreground" />
              <p className="text-sm font-semibold">Нажмите «Сформировать»</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Модель вернёт структурированный dashboard с карточками
              </p>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
