"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { SessionToolbar } from "@/components/strategy/session-toolbar";
import { SessionFocusBar } from "@/components/strategy/session-focus-bar";
import { GenerationFocusControls } from "@/components/strategy/generation-focus-controls";
import { StructuredDashboard } from "@/components/strategy/structured/structured-dashboard";
import { ErrorBoundary } from "@/components/strategy/structured/error-boundary";
import { GenerationProgress } from "@/components/strategy/structured/generation-progress";
import { BlocksGenerationProgress } from "@/components/strategy/structured/blocks-generation-progress";
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
  const [useBlocks, setUseBlocks] = useState(false);
  const [blocksActive, setBlocksActive] = useState(false);
  const [blockRunId, setBlockRunId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/sessions/${sessionId}`)
      .then((r) => r.json())
      .then((data: { session?: SessionProfile; structuredOutput?: TypedOutput }) => {
        if (data.session) {
          setSession(data.session);
          const isRegion = data.session.taskType === "region_strategy" || data.session.taskType === "sber_region_strategy";
          const isMeeting = data.session.taskType === "meeting_preparation" || data.session.taskType === "meeting_followup";
          // Многоблочный путь: регион и встреча. Остальные типы — одноходовые.
          setUseBlocks(isRegion || isMeeting);
        }
        if (data.structuredOutput) {
          setOutput(data.structuredOutput);
        } else {
          try {
            const raw = localStorage.getItem(`sout-${sessionId}`);
            if (raw) setOutput(JSON.parse(raw) as TypedOutput);
          } catch {}
        }
      })
      .finally(() => setInitialLoading(false));
  }, [sessionId]);

  useEffect(() => {
    if (!initialLoading && session && !output && !loading) {
      generate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLoading, session]);

  useEffect(() => {
    if (!output || loading || feedbackReminderShown) return;
    const timer = window.setTimeout(() => {
      toast("Оцените результат - система обновит правила и память на основе вашей оценки");
      setFeedbackReminderShown(true);
    }, 12000);
    return () => window.clearTimeout(timer);
  }, [feedbackReminderShown, loading, output]);

  useEffect(() => {
    if (!output || loading || !window.location.hash) return;
    const id = window.location.hash.slice(1);
    const timer = window.setTimeout(() => {
      const el = document.getElementById(id);
      if (el) {
        const header = document.getElementById("session-focus-bar");
        const headerHeight = header ? header.offsetHeight + 16 : 96;
        const y = el.getBoundingClientRect().top + window.scrollY - headerHeight;
        window.scrollTo({ top: y, behavior: "smooth" });
      }
    }, 100);
    return () => window.clearTimeout(timer);
  }, [loading, output]);

  const handleBlocksComplete = useCallback((result: TypedOutput) => {
    setOutput(result);
    setBlocksActive(false);
    setBlockRunId(null);
    setLoading(false);
    toast.success(result.kind === "meeting" ? "Материал встречи сформирован" : "Региональный анализ сформирован");
  }, []);

  const handleBlocksError = useCallback((error: string) => {
    setBlocksActive(false);
    setBlockRunId(null);
    setLoading(false);
    toast.error(error);
  }, []);

  async function generate(prompt = "") {
    setOutput(null);
    try {
      localStorage.removeItem(`sout-${sessionId}`);
    } catch {}
    setLoading(true);

    if (useBlocks) {
      setBlocksActive(true);
      setBlockRunId(null);
      try {
        const res = await fetch("/api/generate/blocks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, prompt }),
        });
        if (!res.ok) {
          throw new Error("Не удалось запустить генерацию");
        }
        const data = (await res.json().catch(() => ({}))) as { runId?: string };
        if (data.runId) setBlockRunId(data.runId);
        toast("Запущена поблочная генерация");
        return;
      } catch (error) {
        setBlocksActive(false);
        setLoading(false);
        toast.error(error instanceof Error ? error.message : "Ошибка запуска генерации");
        return;
      }
    }

    try {
      const startResponse = await fetch("/api/generate/structured", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, prompt }),
      });

      if (!startResponse.ok) {
        const err = (await startResponse.json().catch(() => ({}))) as { error?: string };
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
        toast("Генерация запущена, ожидание результата...");
        await pollForResult();
      } else {
        throw new Error(data.error || "Неизвестная ошибка");
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Ошибка генерации";
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
          <>
            <div className="static">
              <SessionToolbar session={session} onRenamed={(s) => setSession(s)} />
            </div>

            {output && !loading && (
              <SessionFocusBar
                id="session-focus-bar"
                session={session}
                output={output}
                loading={loading}
                onRegenerate={() => generate()}
              />
            )}
          </>
        )}

        {blocksActive ? (
          <BlocksGenerationProgress
            sessionId={sessionId}
            runId={blockRunId ?? undefined}
            taskType={session?.taskType}
            onComplete={handleBlocksComplete}
            onError={handleBlocksError}
          />
        ) : (
          <GenerationProgress active={loading} />
        )}

        {session && (
          <GenerationFocusControls session={session} loading={loading} onGenerate={generate} />
        )}

        {output && !loading && (
          <ErrorBoundary>
            <StructuredDashboard output={output} />
          </ErrorBoundary>
        )}

        {output && !loading && (
          <div className="space-y-4">
            <ActionBar sessionId={sessionId} />
            <FeedbackWidget sessionId={sessionId} onEvolved={() => generate()} />
          </div>
        )}

        {!output && !loading && (
          <div className="flex min-h-80 items-center justify-center rounded-2xl border border-dashed">
            <div className="text-center">
              <Sparkles className="mx-auto mb-3 size-8 text-muted-foreground" />
              <p className="text-sm font-semibold">Формирование материала...</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {useBlocks
                  ? "Материал собирается блоками: поиск, факты, проверка источников по каждой секции"
                  : "Если генерация не началась автоматически:"}
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
