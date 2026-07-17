"use client";

import { useState } from "react";
import {
  CheckCircle2,
  Landmark,
  Lightbulb,
  Zap,
  Users,
  HelpCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { TypedText } from "./typed-text";
import type { RegionAnalysisOutput } from "@/lib/schemas/structured-output";

function Badge({ children, color = "primary" }: { children: React.ReactNode; color?: string }) {
  const colors: Record<string, string> = {
    primary: "bg-primary/10 text-primary",
    emerald: "bg-emerald-500/10 text-emerald-600",
    amber: "bg-amber-500/10 text-amber-600",
    red: "bg-red-500/10 text-red-600",
    slate: "bg-muted text-muted-foreground",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${colors[color] || colors.primary}`}>
      {children}
    </span>
  );
}

function StatBox({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  const empty = !value?.trim() || /нужно снять/i.test(value);
  if (empty) return null;
  return (
    <div className="rounded-lg bg-muted/30 p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
        {icon}
        {label}
      </div>
      <p className="text-base font-bold"><TypedText text={value} speed={20} /></p>
    </div>
  );
}

// ─── SUMMARY ──────────────────────────────────────────────────────────────────

export function BlockSummary({ data }: { data: Pick<RegionAnalysisOutput, "regionSummary" | "coreThesis"> }) {
  const s = data.regionSummary;
  return (
    <div>
      <p className="text-lg font-bold">{s.name}</p>
      {s.federalDistrict && <p className="text-xs text-muted-foreground mt-0.5">{s.federalDistrict}</p>}
      <div className="grid grid-cols-2 gap-2 mt-3">
        <StatBox icon={<Users className="size-3" />} label="Население" value={s.population} />
        <StatBox icon={<Landmark className="size-3" />} label="Бюджет" value={s.budgetTotal} />
      </div>
      {s.oneLiner && <p className="text-sm text-muted-foreground mt-3 leading-relaxed"><TypedText text={s.oneLiner} speed={25} /></p>}
      {data.coreThesis?.headline && <BlockThesisCard thesis={data.coreThesis} />}
    </div>
  );
}

function BlockThesisCard({ thesis }: { thesis: NonNullable<RegionAnalysisOutput["coreThesis"]> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 rounded-lg border border-primary/20 bg-primary/[0.02] p-3">
      <div className="flex items-start gap-2">
        <Lightbulb className="size-4 text-primary shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-snug"><TypedText text={thesis.headline} speed={20} /></p>
          <div className="flex gap-2 mt-2">
            <Badge color="emerald">{thesis.surfaceSignal.slice(0, 40)}</Badge>
            <Badge color="amber">{thesis.hiddenReality.slice(0, 40)}</Badge>
          </div>
          {thesis.evidence && thesis.evidence.length > 0 && (
            <>
              <button onClick={() => setOpen(!open)} className="flex items-center gap-1 text-[10px] text-muted-foreground mt-2 hover:text-foreground transition-colors">
                {open ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                {thesis.evidence.length} подтверждающих факта
              </button>
              {open && (
                <div className="mt-2 space-y-1">
                  {thesis.evidence.map((e, i) => (
                    <p key={i} className="text-xs text-muted-foreground flex gap-2">
                      <span className="text-primary mt-1">•</span>
                      <TypedText text={e} speed={25} />
                    </p>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── INDUSTRIES ───────────────────────────────────────────────────────────────

export function BlockIndustries({ data }: { data: Pick<RegionAnalysisOutput, "industryBreakdown"> }) {
  const items = (data.industryBreakdown || []).slice(0, 4);
  if (!items.length) return null;
  return (
    <div className="space-y-2">
      {items.map((ind) => (
        <div key={ind.id} className="flex items-start gap-3 rounded-lg border p-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium"><TypedText text={ind.name} speed={15} /></p>
            {ind.keyEnterprises && ind.keyEnterprises.length > 0 && (
              <div className="mt-2 space-y-1">
                {ind.keyEnterprises.map((e, i) => (
                  <div key={i} className="text-xs">
                    <span className="font-medium">{e.name}</span>
                    {e.description && <span className="text-muted-foreground"> — {e.description}</span>}
                  </div>
                ))}
              </div>
            )}
            {ind.limitations && ind.limitations.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {ind.limitations.map((p, i) => (
                  <Badge key={i} color="red">{p}</Badge>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── BUDGET ────────────────────────────────────────────────────────────────────

export function BlockBudget({ data }: { data: Pick<RegionAnalysisOutput, "budgetLandscape"> }) {
  const b = data.budgetLandscape;
  if (!b) return null;

  const expenses = (b.breakdown ?? [])
    .filter((x) => x.kind === "expense" && Number.isFinite(x.value) && x.value > 0)
    .sort((a, z) => z.value - a.value);
  const maxVal = expenses.length > 0 ? Math.max(...expenses.map((e) => e.value), 1) : 1;
  const hasData = b.totalBudget || b.itShare || expenses.length > 0;

  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <StatBox icon={<Landmark className="size-3" />} label="Бюджет" value={b.totalBudget || ""} />
        <StatBox icon={<Zap className="size-3" />} label="Доля ИТ" value={b.itShare || ""} />
      </div>
      {expenses.length >= 2 && (
        <div className="mt-3 rounded-lg border p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Структура расходов</p>
          <div className="space-y-1.5">
            {expenses.slice(0, 6).map((item) => (
              <div key={item.id}>
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="min-w-0 text-xs leading-snug">{item.name}</span>
                  <span className="shrink-0 text-right text-xs tabular-nums">{item.value.toLocaleString("ru-RU")} {item.unit || "млрд ₽"}</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-emerald-500/70" style={{ width: `${Math.max(2, (item.value / maxVal) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {!hasData && <p className="text-sm text-muted-foreground italic mt-2">Бюджетный контур требует проверки по первичному источнику</p>}
    </div>
  );
}

// ─── SCENARIOS ─────────────────────────────────────────────────────────────────

export function BlockScenarios({ data }: { data: Pick<RegionAnalysisOutput, "regionalScenarios"> }) {
  const items = (data.regionalScenarios || []).slice(0, 3);
  if (!items.length) return null;
  return (
    <div className="space-y-2">
      {items.map((sc) => (
        <div key={sc.id} className="rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <span className={`size-2 rounded-full ${sc.probability === "high" ? "bg-emerald-500" : sc.probability === "medium" ? "bg-amber-500" : "bg-red-500"}`} />
            <p className="text-sm font-medium"><TypedText text={sc.title} speed={15} /></p>
            <Badge color="slate">{sc.horizon || "5 лет"}</Badge>
          </div>
          {sc.trigger && <p className="text-xs text-muted-foreground mt-1">Триггер: <TypedText text={sc.trigger} speed={22} /></p>}
        </div>
      ))}
    </div>
  );
}

// ─── PRIORITIES ────────────────────────────────────────────────────────────────

export function BlockPriorities({ data }: { data: Pick<RegionAnalysisOutput, "strategicPriorities" | "dataGaps" | "risks" | "nextSteps" | "hypotheses" | "sources"> }) {
  const p = data.strategicPriorities;
  if (!p || (!p.confirmed?.length && !p.hypothesized?.length)) {
    return null;
  }
  return (
    <div className="space-y-2">
      {p.confirmed?.slice(0, 4).map((item, i) => (
        <div key={i} className="flex items-start gap-2 rounded-lg border border-emerald-500/10 bg-emerald-500/[0.03] p-2">
          <CheckCircle2 className="size-4 text-emerald-500 shrink-0 mt-0.5" />
          <p className="text-xs"><TypedText text={item} speed={22} /></p>
        </div>
      ))}
      {p.roadmap?.slice(0, 4).map((item) => (
        <div key={item.id} className="rounded-lg border p-2">
          <div className="flex gap-2">
            <Badge color="slate">{item.period}</Badge>
            <p className="text-xs font-medium"><TypedText text={item.title} speed={22} /></p>
          </div>
          {item.linkedProgram && <p className="mt-1 text-[10px] text-muted-foreground">Связь: {item.linkedProgram}</p>}
        </div>
      ))}
      {p.hypothesized?.slice(0, 3).map((item, i) => (
        <div key={`h-${i}`} className="flex items-start gap-2 rounded-lg border border-amber-500/10 bg-amber-500/[0.03] p-2">
          <HelpCircle className="size-4 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-xs"><TypedText text={item} speed={22} /></p>
        </div>
      ))}
    </div>
  );
}

// ─── HYPOTHESES (compact) ─────────────────────────────────────────────────────

export function BlockHypotheses({ data }: { data: Pick<RegionAnalysisOutput, "hypotheses" | "dataGaps"> }) {
  const items = [...(data.hypotheses || []), ...(data.dataGaps || []).map((g) => g.question)].slice(0, 5);
  if (!items.length) return null;
  return (
    <div className="space-y-1.5">
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-2 text-xs">
          <HelpCircle className="size-3 text-amber-500 shrink-0 mt-0.5" />
          <p><TypedText text={item} speed={22} /></p>
        </div>
      ))}
    </div>
  );
}
