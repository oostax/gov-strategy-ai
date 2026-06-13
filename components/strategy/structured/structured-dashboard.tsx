"use client";

import type { TypedOutput, StructuredOutput, MeetingOutput, BriefOutput, RegionAnalysisOutput } from "@/lib/schemas/structured-output";
import { DecisionHero } from "./decision-hero";
import { BetsGrid } from "./bets-grid";
import { PlanTimeline } from "./plan-timeline";
import { MetricsDashboard } from "./metrics-dashboard";
import { RisksPanel } from "./risks-panel";
import { NextStepsBar } from "./next-steps-bar";
import { SourcesFooter } from "./sources-footer";
import { MeetingDashboard } from "./meeting-dashboard";
import { BriefDashboard } from "./brief-dashboard";
import { RegionDashboard } from "./region-dashboard";
import { VisualsSection } from "./visuals-section";
import { SberActionPanel } from "./sber-action-panel";
import { BetsDecisionMatrix } from "./bets-decision-matrix";
import { BetsEffortImpact, hasEffortImpact } from "./bets-effort-impact";
import { EconomicsSummary } from "./economics-summary";
import { KpiStrip } from "./kpi-strip";
import { ExecutiveHints } from "./executive-hints";

export function StructuredDashboard({ output }: { output: TypedOutput }) {
  if (output.kind === "meeting") {
    return (
      <div className="space-y-5">
        <ExecutiveHints kind="meeting" />
        <MeetingDashboard data={output.data as MeetingOutput} />
      </div>
    );
  }
  if (output.kind === "brief") {
    return (
      <div className="space-y-5">
        <ExecutiveHints kind="brief" />
        <BriefDashboard data={output.data as BriefOutput} />
      </div>
    );
  }
  if (output.kind === "region") {
    return (
      <div className="space-y-5">
        <ExecutiveHints kind="strategy" />
        <RegionDashboard data={output.data as RegionAnalysisOutput} />
      </div>
    );
  }

  const data = output.data as StructuredOutput;
  const bets = data.bets ?? [];
  return (
    <div className="space-y-5">
      <ExecutiveHints kind="strategy" />
      <div id="decision" className="scroll-mt-56 animate-in fade-in slide-in-from-top-2 duration-500">
        <DecisionHero
          decision={data.decision}
          whyNow={data.whyNow}
          costOfInaction={data.costOfInaction}
          sberRole={data.sberRole}
          verdict={data.verdict}
        />
      </div>

      {data.economics && (
        <div id="economics" className="scroll-mt-56 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-75">
          <EconomicsSummary economics={data.economics} />
        </div>
      )}

      <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 delay-100">
        <KpiStrip
          bets={bets}
          risks={data.risks ?? []}
          metrics={data.metrics ?? []}
          nextSteps={data.nextSteps ?? []}
          planStages={(data.plan ?? []).length}
        />
      </div>

      <div id="bets" className="scroll-mt-56 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-150">
        <BetsGrid bets={bets} />
      </div>

      <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 delay-200">
        {hasEffortImpact(bets) ? <BetsEffortImpact bets={bets} /> : <BetsDecisionMatrix bets={bets} />}
      </div>

      {/* Аналитический кластер: дополнительная инфографика рядом с матрицей выбора */}
      <div id="visuals" className="scroll-mt-56">
        <VisualsSection visuals={data.visuals ?? []} />
      </div>

      {/* Роль Сбера — мост от выбора к исполнению */}
      <div id="sber-actions" className="scroll-mt-56">
        <SberActionPanel actions={data.sberActions ?? []} />
      </div>

      <div id="plan" className="scroll-mt-56 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-300">
        <PlanTimeline stages={data.plan ?? []} />
      </div>
      <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 delay-300 grid gap-5 xl:grid-cols-2">
        <div id="metrics" className="scroll-mt-56">
          <MetricsDashboard metrics={data.metrics ?? []} />
        </div>
        <div id="risks" className="scroll-mt-56">
          <RisksPanel risks={data.risks ?? []} />
        </div>
      </div>
      <div id="next-steps" className="scroll-mt-56 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-400">
        <NextStepsBar steps={data.nextSteps ?? []} />
      </div>
      <div id="sources" className="scroll-mt-56 animate-in fade-in duration-500 delay-500">
        <SourcesFooter sources={data.sources ?? []} hypotheses={data.hypotheses ?? []} />
      </div>
    </div>
  );
}
