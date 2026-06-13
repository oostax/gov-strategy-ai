"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { SessionToolbar } from "@/components/strategy/session-toolbar";
import { SessionFocusBar } from "@/components/strategy/session-focus-bar";
import { StructuredDashboard } from "@/components/strategy/structured/structured-dashboard";
import { GenerationProgress } from "@/components/strategy/structured/generation-progress";
import { ActionBar } from "@/components/strategy/structured/action-bar";
import { FeedbackWidget } from "@/components/strategy/structured/feedback-widget";
import type { TypedOutput } from "@/lib/schemas/structured-output";
import type { SessionProfile } from "@/lib/schemas/session";

export default function SessionPage() {
  const params = useParams<{ id: string }>();
  const sessionId = params.id;

  const [session, setSession] = useState<SessionProfile | null>(null);
  const [output, setOutput] = useState<TypedOutput | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [feedbackReminderShown, setFeedbackReminderShown] = useState(false);

  useEffect(() => {
    // Load session data and check for cached output
    fetch(`/api/sessions/${sessionId}`)
      .then((r) => r.json())
      .then((data: { session?: SessionProfile; structuredOutput?: TypedOutput }) => {
        if (data.session) setSession(data.session);
        // Try server-side cached output first
        if (data.structuredOutput) {
          setOutput(data.structuredOutput);
        } else {
          // Fallback to localStorage
          try {
            const raw = localStorage.getItem(`sout-${sessionId}`);
            if (raw) setOutput(JSON.parse(raw) as TypedOutput);
          } catch {}
        }
      })
      .finally(() => setInitialLoading(false));
  }, [sessionId]);

  // Auto-generate ONLY if no cached output and no output loaded
  useEffect(() => {
    if (!initialLoading && session && !output && !loading) {
      generate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLoading, session]);

  useEffect(() => {
    if (!output || loading || feedbackReminderShown) return;
    const timer = window.setTimeout(() => {
      toast("Оцените результат — система обновит правила и память на основе вашей оценки");
      setFeedbackReminderShown(true);
    }, 12000);
    return () => window.clearTimeout(timer);
  }, [feedbackReminderShown, loading, output]);

  useEffect(() => {
    if (!output || loading || !window.location.hash) return;
    const id = window.location.hash.slice(1);
    const timer = window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ block: "start" });
    }, 100);
    return () => window.clearTimeout(timer);
  }, [loading, output]);

  async function generate(prompt = "") {
    setOutput(null);
    try {
      localStorage.removeItem(`sout-${sessionId}`);
    } catch {}
    setLoading(true);
    try {
      // Используем SSE-подобный подход: запускаем генерацию и поллим результат
      const startResponse = await fetch("/api/generate/structured", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, prompt }),
      });

      if (!startResponse.ok) {
        const err = await startResponse.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error || `Ошибка: ${startResponse.status}`);
      }

      const data = (await startResponse.json()) as {
        output?: TypedOutput;
        error?: string;
        status?: string;
      };

      if (data.output) {
        setOutput(data.output);
        toast.success("Материал сформирован");
      } else if (data.status === "generating") {
        // Поллим результат каждые 5 секунд
        toast("Генерация запущена, ожидание результата...");
        await pollForResult();
      } else {
        throw new Error(data.error || "Неизвестная ошибка");
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Ошибка генерации";
      // Если таймаут — пробуем поллить результат
      if (msg.includes("aborted") || msg.includes("timeout") || msg.includes("pattern")) {
        toast("Генерация выполняется, проверка результата...");
        await pollForResult();
      } else {
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  async function pollForResult() {
    // Поллим /api/sessions/{id} каждые 5 секунд до 3 минут (первая проверка сразу)
    for (let i = 0; i < 36; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 5000));
      try {
        const res = await fetch(`/api/sessions/${sessionId}`);
        const data = (await res.json()) as {
          structuredOutput?: TypedOutput;
          generationError?: string | null;
        };
        if (data.structuredOutput) {
          setOutput(data.structuredOutput);
          toast.success("Материал готов");
          return;
        }
        if (data.generationError) {
          toast.error(data.generationError);
          return;
        }
      } catch {}
    }
    toast.error("Генерация заняла слишком долго. Попробуйте ещё раз.");
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
          <SessionToolbar session={session} onRenamed={(s) => setSession(s)} />
        )}

        {/* Progress bar during generation */}
        <GenerationProgress active={loading} />

        {/* Regenerate button (shown when output exists) */}
        {output && !loading && (
          <div className="flex items-center justify-between gap-3 rounded-2xl border bg-card px-4 py-3">
            <p className="text-sm text-muted-foreground">
              Генерация Gigachat-3 10B
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => generate()}
              disabled={loading}
            >
              <RefreshCw className="size-3.5" /> Сформировать заново
            </Button>
          </div>
        )}

        {session && output && !loading && <SessionFocusBar session={session} output={output} />}

        {/* Main output — скрываем на время пересборки */}
        {output && !loading && <StructuredDashboard output={output} />}

        {/* Action bar + Feedback (shown after output) */}
        {output && !loading && (
          <div className="space-y-4">
            <ActionBar sessionId={sessionId} />
            <FeedbackWidget
              sessionId={sessionId}
              onEvolved={() => generate()}
            />
          </div>
        )}

        {/* Empty state (only if no output and not loading) */}
        {!output && !loading && (
          <div className="flex min-h-80 items-center justify-center rounded-2xl border border-dashed">
            <div className="text-center">
              <Sparkles className="mx-auto mb-3 size-8 text-muted-foreground" />
              <p className="text-sm font-semibold">Формирование материала...</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Если генерация не началась автоматически:
              </p>
              <Button className="mt-3" onClick={() => generate()}>
                <Sparkles className="size-4" /> Сформировать
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
