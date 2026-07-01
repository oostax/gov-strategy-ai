import { NextResponse } from "next/server";
import { getStorage } from "@/lib/storage/local-json-storage";
import type { RegionAnalysisOutput } from "@/lib/schemas/structured-output";

export const runtime = "nodejs";

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!SAFE_ID.test(id)) {
      return NextResponse.json({ error: "Invalid region ID" }, { status: 400 });
    }

    const body = await request.json() as {
      sessionId?: string;
      analysis?: RegionAnalysisOutput;
    };

    if (!body.sessionId || !body.analysis) {
      return NextResponse.json({ error: "sessionId and analysis required" }, { status: 400 });
    }

    const storage = getStorage();
    const region = await storage.getRegion(id);
    if (!region) {
      return NextResponse.json({ error: "Region not found" }, { status: 404 });
    }

    const analysis = body.analysis;
    const patch: Record<string, unknown> = {};

    if (analysis.regionSummary) {
      if (analysis.regionSummary.federalDistrict) patch.federalDistrict = analysis.regionSummary.federalDistrict;
      if (analysis.regionSummary.population) patch.population = analysis.regionSummary.population;
      if (analysis.regionSummary.budgetTotal) patch.budgetProfile = analysis.regionSummary.budgetTotal;
    }

    if (analysis.budgetLandscape) {
      const parts: string[] = [];
      if (analysis.budgetLandscape.totalBudget) parts.push(analysis.budgetLandscape.totalBudget);
      if (analysis.budgetLandscape.totalIncomeValue) parts.push(`Доходы: ${analysis.budgetLandscape.totalIncomeValue} млрд ₽`);
      if (analysis.budgetLandscape.totalExpenseValue) parts.push(`Расходы: ${analysis.budgetLandscape.totalExpenseValue} млрд ₽`);
      if (parts.length) patch.budgetProfile = parts.join("; ");
    }

    if (analysis.industryBreakdown?.length) {
      patch.painPoints = analysis.industryBreakdown
        .flatMap((ind) => ind.limitations || [])
        .filter(Boolean)
        .slice(0, 8);
    }

    if (analysis.stakeholderMap?.length) {
      patch.stakeholders = analysis.stakeholderMap.map((s, i) => ({
        id: s.id || `stk_sync_${i}`,
        fullName: s.name,
        role: s.role,
        department: s.department,
        motivation: s.managementInterest || "",
        redFlags: "",
        relationship: "cold" as const,
        notes: [s.achievements, s.recentNews].filter(Boolean).join(" | ") || "",
      }));
    }

    if (analysis.strategicPriorities?.confirmed?.length) {
      patch.topPriorities = analysis.strategicPriorities.confirmed.map((title, i) => ({
        id: `pri_sync_${i}`,
        title,
        source: analysis.strategicPriorities?.source || "",
      }));
    }

    const updated = await storage.updateRegion(id, patch);
    return NextResponse.json({ region: updated, synced: Object.keys(patch) });
  } catch (error) {
    console.error("[region-sync]", error);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
