"use client";

import { useEffect, useState, useRef } from "react";
import { Sparkles, Timer, Search, Brain, CheckCircle2, Clock, ShieldCheck, FileText, Layers3, Radar } from "lucide-react";
import { BLOCK_LABELS, BLOCK_ORDER, type BlockKind, type BlockStatus } from "@/lib/agents/region-blocks/types";
import type { RegionAnalysisOutput, TypedOutput } from "@/lib/schemas/structured-output";
import { BlockSummary, BlockIndustries, BlockBudget, BlockScenarios, BlockPriorities } from "./reveal-blocks";

interface BlockProgressData {
  kind: BlockKind;
  status: BlockStatus;
  label: string;
  data: Record<string, unknown> | null;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "В очереди",
  searching: "Идёт поиск",
  generating: "Идёт генерация",
  ready: "Готово",
  failed: "Ошибка",
};

function StatusDot({ status }: { status: string }) {
  if (status === "ready") return <CheckCircle2 className="size-3.5 text-emerald-500" />;
  if (status === "searching") return <Search className="size-3.5 animate-pulse text-blue-500" />;
  if (status === "generating") return <Brain className="size-3.5 animate-pulse text-primary" />;
  if (status === "failed") return <Clock className="size-3.5 text-destructive" />;
  return <Clock className="size-3.5 text-muted-foreground/45" />;
}

export function BlocksGenerationProgress({
  sessionId,
  runId,
  onComplete,
  onError,
}: {
  sessionId: string;
  runId?: string;
  onComplete: (output: TypedOutput) => void;
  onError: (error: string) => void;
}) {
  const [blocksStatus, setBlocksStatus] = useState<BlockProgressData[]>(
    BLOCK_ORDER.map((k) => ({ kind: k, status: "pending" as BlockStatus, label: BLOCK_LABELS[k], data: null })),
  );
  const [elapsed, setElapsed] = useState(0);
  const [readyData, setReadyData] = useState<Record<string, Record<string, unknown>>>({});
  const pollingRef = useRef(true);

  useEffect(() => {
    pollingRef.current = true;
    const startTime = Date.now();
    setReadyData({});
    setBlocksStatus(
      BLOCK_ORDER.map((k) => ({ kind: k, status: "pending" as BlockStatus, label: BLOCK_LABELS[k], data: null })),
    );

    if (!runId) {
      const timer = window.setInterval(() => {
        setElapsed((Date.now() - startTime) / 1000);
      }, 500);
      return () => {
        pollingRef.current = false;
        window.clearInterval(timer);
      };
    }

    async function poll() {
      while (pollingRef.current) {
        try {
          const suffix = runId ? `?runId=${encodeURIComponent(runId)}` : "";
          const res = await fetch(`/api/generate/blocks/${sessionId}${suffix}`);
          const d = await res.json();

          if (d.status === "error") {
            pollingRef.current = false;
            onError(d.error?.message || "Ошибка генерации");
            return;
          }
          if (d.status === "ready" && d.output) {
            pollingRef.current = false;
            onComplete(d.output);
            return;
          }

          if (d.blocks) {
            const updated = (d.blocks as BlockProgressData[]);
            setBlocksStatus(updated);
            setReadyData((prev) => {
              const next = { ...prev };
              for (const b of updated) {
                if (b.status === "ready" && b.data) {
                  next[b.kind] = b.data;
                }
              }
              return next;
            });
          }

          setElapsed((Date.now() - startTime) / 1000);
        } catch {}
        await new Promise((r) => setTimeout(r, 1500));
      }
    }

    poll();
    return () => { pollingRef.current = false; };
  }, [sessionId, runId, onComplete, onError]);

  const readyArr = BLOCK_ORDER.filter((k) => readyData[k]);
  const readyCount = readyArr.length;
  const activeCount = blocksStatus.filter((block) => block.status === "searching" || block.status === "generating").length;
  const visualProgress = Math.min(98, Math.round(((readyCount + activeCount * 0.45) / BLOCK_ORDER.length) * 100));
  const sourceStats = Object.values(readyData).reduce<{ total: number; verified: number }>(
    (acc, block) => {
      const sources = Array.isArray(block.sources) ? block.sources : [];
      acc.total += sources.length;
      acc.verified += sources.filter((source) => {
        if (!source || typeof source !== "object") return false;
        return (source as { isVerified?: unknown }).isVerified === true;
      }).length;
      return acc;
    },
    { total: 0, verified: 0 },
  );
  const activeBlocks = blocksStatus
    .filter((block) => block.status === "searching" || block.status === "generating")
    .map((block) => BLOCK_LABELS[block.kind]);
  const activeLabel = activeBlocks.length
    ? activeBlocks.join(", ")
    : readyCount === BLOCK_ORDER.length
      ? "Финальная сборка материала"
      : runId
        ? "Подготовка контура поиска"
        : "Планирование блоков и запросов";

  const pipeline = [
    { label: "План", active: !runId || blocksStatus.some((b) => b.status !== "pending"), done: Boolean(runId) },
    { label: "Поиск", active: blocksStatus.some((b) => b.status === "searching"), done: readyCount > 0 },
    { label: "Факты", active: blocksStatus.some((b) => b.status === "generating"), done: readyCount >= 3 },
    { label: "Сборка", active: readyCount >= BLOCK_ORDER.length - 1, done: readyCount === BLOCK_ORDER.length },
  ];

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="relative border-b bg-[linear-gradient(110deg,hsl(var(--card)),hsl(var(--muted)/0.35),hsl(var(--card)))] p-4">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
          <div className="pointer-events-none absolute inset-0 opacity-[0.08] [background-image:linear-gradient(to_right,currentColor_1px,transparent_1px),linear-gradient(to_bottom,currentColor_1px,transparent_1px)] [background-size:28px_28px]" />
          <div className="relative flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="relative mt-0.5 grid size-9 place-items-center rounded-xl border bg-background shadow-sm">
                <Radar className="size-4 text-primary" />
                <span className="absolute inset-0 rounded-xl border border-primary/40 animate-ping" />
              </div>
              <div>
                <p className="text-sm font-semibold">Генерация регионального анализа</p>
                <p className="mt-1 text-xs text-muted-foreground">{activeLabel}</p>
              </div>
            </div>
            <div className="shrink-0 text-right text-[11px] text-muted-foreground">
              <span className="tabular-nums inline-flex items-center gap-1">
                <Timer className="size-3" />
                {Math.floor(elapsed / 60)}:{Math.floor(elapsed % 60).toString().padStart(2, "0")}
              </span>
              <p className="mt-1 font-medium text-foreground">{readyCount}/{BLOCK_ORDER.length} блоков</p>
            </div>
          </div>

          <div className="relative mt-4 grid grid-cols-4 gap-2">
            {pipeline.map((step) => (
              <div
                key={step.label}
                className={`rounded-lg border px-2 py-2 text-center text-[11px] font-medium transition-all duration-500 ${
                  step.done
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
                    : step.active
                      ? "border-primary/30 bg-primary/10 text-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.08)]"
                      : "bg-background/70 text-muted-foreground"
                }`}
              >
                {step.label}
              </div>
            ))}
          </div>
        </div>

        <div className="h-1.5 w-full bg-muted">
          <div
            className="h-full bg-[linear-gradient(90deg,hsl(var(--primary)),#10b981,#38bdf8)] transition-all duration-700"
            style={{ width: `${runId ? visualProgress : 8}%` }}
          />
        </div>

        <div className="flex items-center justify-between p-3 border-b">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <p className="text-xs font-semibold text-muted-foreground">Контроль качества сборки</p>
          </div>
          <p className="text-[11px] text-muted-foreground">{runId ? "Запуск подтверждён" : "Ожидание постановки в очередь"}</p>
        </div>

        <div className="grid gap-px bg-border/50 sm:grid-cols-3">
          <div className="bg-card p-3">
            <div className="flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
              <Layers3 className="size-3.5" />
              Сейчас
            </div>
            <p className="mt-1 truncate text-sm font-medium">{activeLabel}</p>
          </div>
          <div className="bg-card p-3">
            <div className="flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
              <FileText className="size-3.5" />
              Источники
            </div>
            <p className="mt-1 text-sm font-medium">{sourceStats.total || "Идёт поиск"}</p>
          </div>
          <div className="bg-card p-3">
            <div className="flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
              <ShieldCheck className="size-3.5" />
              Проверка
            </div>
            <p className="mt-1 text-sm font-medium">{sourceStats.verified ? `${sourceStats.verified} подтверждено` : "Неподтверждённых чисел нет"}</p>
          </div>
        </div>

        <ul className="divide-y divide-border/50">
          {blocksStatus.map((block) => (
            <li
              key={block.kind}
              className={`flex items-center justify-between gap-3 bg-card px-3 py-2 transition-colors duration-500 ${
                block.status === "searching" || block.status === "generating"
                  ? "bg-primary/[0.035]"
                  : ""
              }`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <StatusDot status={block.status} />
                <span className="truncate text-xs">{BLOCK_LABELS[block.kind]}</span>
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {STATUS_LABELS[block.status]}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {readyArr.length > 0 && (
        <div className="space-y-3">
          {readyArr.map((kind) => {
            const data = readyData[kind];
            if (!data) return null;
            return (
              <div key={kind}>
                <div className="flex items-center gap-2 mb-1.5">
                  <CheckCircle2 className="size-3.5 text-emerald-500" />
                  <p className="text-xs font-semibold">{BLOCK_LABELS[kind]}</p>
                </div>
                <div className="rounded-xl border bg-card p-3 animate-in fade-in slide-in-from-bottom-2 duration-500">
                  {renderBlockContent(kind, data)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function renderBlockContent(kind: BlockKind, data: Record<string, unknown>): React.ReactNode {
  const typed = data as Partial<RegionAnalysisOutput>;
  switch (kind) {
    case "summary":
      return <BlockSummary data={{ regionSummary: typed.regionSummary, coreThesis: typed.coreThesis } as Pick<RegionAnalysisOutput, "regionSummary" | "coreThesis">} />;
    case "industries":
      return <BlockIndustries data={{ industryBreakdown: typed.industryBreakdown } as Pick<RegionAnalysisOutput, "industryBreakdown">} />;
    case "budget":
      return <BlockBudget data={{ budgetLandscape: typed.budgetLandscape } as Pick<RegionAnalysisOutput, "budgetLandscape">} />;
    case "scenarios":
      return <BlockScenarios data={{ regionalScenarios: typed.regionalScenarios } as Pick<RegionAnalysisOutput, "regionalScenarios">} />;
    case "priorities":
      return <BlockPriorities data={{ strategicPriorities: typed.strategicPriorities, hypotheses: typed.hypotheses, sources: typed.sources } as Pick<RegionAnalysisOutput, "strategicPriorities" | "hypotheses" | "sources" | "dataGaps" | "risks" | "nextSteps">} />;
    case "competition": {
      const cl = typed.competitiveLandscape || [];
      return (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold text-muted-foreground">Альтернативы ({cl.length})</p>
          <div className="space-y-1.5">
            {cl.slice(0, 5).map((c, i) => (
              <div key={c.id || i} className="flex items-center gap-2 text-xs rounded-lg border p-2">
                <span className={`size-2 rounded-full shrink-0 ${c.threatLevel === "high" ? "bg-red-500" : c.threatLevel === "medium" ? "bg-amber-500" : "bg-emerald-500"}`} />
                <div className="min-w-0">
                  <p className="font-medium">{c.vendor}</p>
                  <p className="text-muted-foreground">{c.product}{c.where ? ` · ${c.where}` : ""}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }
    case "stakeholders": {
      const sm = typed.stakeholderMap || [];
      return (
        <div className="space-y-2">
          {sm.slice(0, 4).map((s, i) => (
            <div key={s.id || i} className="rounded-lg border p-2 text-xs">
              <p className="font-medium">{s.name}</p>
              <p className="text-muted-foreground">{s.role}{s.department ? ` · ${s.department}` : ""}</p>
              {s.achievements && <p className="mt-0.5 text-[10px]">{s.achievements}</p>}
            </div>
          ))}
        </div>
      );
    }
    default:
      return null;
  }
}
