import { NextResponse } from "next/server";
import { generateStructured } from "@/lib/agents/structured-generator";
import { selectRelevantPlaybooks } from "@/lib/agents/prompt-builder";
import { generateRequestSchema } from "@/lib/schemas/agent";
import { getStorage } from "@/lib/storage/local-json-storage";
import { getMemoryClient } from "@/lib/integrations/mempalace-client";
import {
  formatEvidenceForPrompt,
  retrieveOpenSources,
} from "@/lib/integrations/web-retrieval";
import { fetchSourceContent } from "@/lib/integrations/content-fetcher";
import { promises as fs } from "fs";
import path from "path";
import type { SessionProfile } from "@/lib/schemas/session";
import type { BudgetBreakdownItem, TypedOutput } from "@/lib/schemas/structured-output";
import type { WebEvidence } from "@/lib/integrations/web-retrieval";
import { writeProgress, clearProgress } from "@/lib/utils/generation-progress";
import { canonicalRegionName } from "@/lib/data/region-normalization";
import { cacheKeyForRegion, readRegionCache } from "@/lib/agents/region-blocks/region-cache";

export const runtime = "nodejs";
export const maxDuration = 300;

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

function validateId(id: string): boolean {
  return SAFE_ID.test(id) && id.length <= 64;
}

async function getCacheDir() {
  const dir = path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "structured");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function atomicWrite(filePath: string, data: string) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, data, "utf8");
  await fs.rename(tempPath, filePath);
}

function parseRuNumber(value: string): number | null {
  const normalized = value.replace(/\s+/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function sourceDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function extractBudgetBreakdownFromEvidence(evidence: WebEvidence[]): BudgetBreakdownItem[] {
  const text = evidence
    .map((item) => `${item.title}\n${item.snippet}\n${item.fullText ?? ""}`)
    .join("\n")
    .replace(/\s+/g, " ");

  const rows = [
    { id: "budget_economy", name: "Национальная экономика", marker: "4. Национальная экономика" },
    { id: "budget_housing", name: "ЖКХ", marker: "5. Жилищно-коммунальное хозяйство" },
    { id: "budget_education", name: "Образование", marker: "7. Образование" },
    { id: "budget_culture", name: "Культура", marker: "8. Культура, кинематография" },
    { id: "budget_health", name: "Здравоохранение", marker: "9. Здравоохранение" },
    { id: "budget_social", name: "Социальная политика", marker: "10. Социальная политика" },
    { id: "budget_sport", name: "Физкультура и спорт", marker: "11. Физическая культура и спорт" },
  ];

  const breakdown: BudgetBreakdownItem[] = [];
  for (const row of rows) {
    const idx = text.indexOf(row.marker);
    if (idx < 0) continue;
    const tail = text.slice(idx + row.marker.length, idx + row.marker.length + 180);
    const tokens = tail.split(/\s+/).filter((token) => /^\d{1,3}$/.test(token));
    const values = [0, 2, 4, 6, 8]
      .map((start) => parseRuNumber(`${tokens[start] ?? ""} ${tokens[start + 1] ?? ""}`))
      .filter((n): n is number => n !== null);
    const value2026 = values[2];
    if (!Number.isFinite(value2026)) continue;
    const sourceItem = evidence.find((item) => {
      const sourceText = `${item.title}\n${item.snippet}\n${item.fullText ?? ""}`;
      return sourceText.includes(row.marker) || sourceText.toLowerCase().includes(row.name.toLowerCase());
    });
    breakdown.push({
      id: row.id,
      name: row.name,
      kind: "expense",
      value: Math.round((value2026 / 1000) * 10) / 10,
      valueRaw: Math.round((value2026 / 1000) * 10) / 10,
      unit: "млрд ₽",
      source: sourceItem ? sourceDomain(sourceItem.url) : undefined,
      sourceUrl: sourceItem?.url,
      evidence: sourceItem ? `${Math.round(value2026).toLocaleString("ru-RU")} млн ₽ по разделу «${row.name}»` : undefined,
    });
  }

  return breakdown.sort((a, b) => b.value - a.value);
}

function normalizeBudgetMoneyValue(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return value;
  // В бюджетных PDF суммы часто приходят в млн ₽. Если поле интерфейса помечено
  // как млрд ₽, приводим масштаб, чтобы не получить "158 587 млрд ₽".
  return value > 10000 ? Math.round((value / 1000) * 10) / 10 : value;
}

function normalizeBudgetBreakdown(
  items: BudgetBreakdownItem[] | undefined,
  evidence: WebEvidence[],
): BudgetBreakdownItem[] | undefined {
  if (!items?.length) return items;
  return items.map((item) => {
    const sourceItem = !item.sourceUrl
      ? evidence.find((ev) => `${ev.title} ${ev.snippet} ${ev.fullText ?? ""}`.toLowerCase().includes(item.name.toLowerCase()))
      : undefined;
    const normalizedValue = /млрд/i.test(item.unit ?? "") ? normalizeBudgetMoneyValue(item.value) : item.value;
    return {
      ...item,
      value: normalizedValue ?? item.value,
      valueRaw: normalizeBudgetMoneyValue(item.valueRaw ?? item.value),
      source: item.source ?? (sourceItem ? sourceDomain(sourceItem.url) : undefined),
      sourceUrl: item.sourceUrl ?? sourceItem?.url,
      evidence: item.evidence ?? (sourceItem ? `Бюджетная статья «${item.name}» найдена в источнике ${sourceDomain(sourceItem.url)}` : undefined),
    };
  });
}

async function enhanceRegionOutput(result: TypedOutput, webEvidence: WebEvidence[]): Promise<TypedOutput> {
  if (result.kind !== "region") return result;
  const budget = result.data.budgetLandscape;

  const generatedSources: WebEvidence[] = (result.data.sources ?? [])
    .filter((source) => Boolean(source.url))
    .map((source) => ({
      title: source.title,
      url: source.url as string,
      snippet: source.excerpt,
      source: source.url as string,
    }));
  const allEvidence = [...webEvidence, ...generatedSources];

  let breakdown = normalizeBudgetBreakdown(budget.breakdown, allEvidence) ?? [];
  if (!breakdown.length) {
    breakdown = extractBudgetBreakdownFromEvidence(allEvidence);
  }
  if (!breakdown.length) {
    const budgetSources = allEvidence.filter((item) =>
      /openbudget23region|budget|бюджет/i.test(`${item.url} ${item.title}`),
    );
    const enriched = await Promise.all(
      budgetSources.slice(0, 3).map(async (item) => {
        const content = await fetchSourceContent(item.url).catch(() => null);
        return content ? { ...item, fullText: content.text } : item;
      }),
    );
    breakdown = extractBudgetBreakdownFromEvidence(enriched);
  }
  const hasBudgetEnhancement =
    breakdown.length > 0 ||
    normalizeBudgetMoneyValue(budget.totalIncomeValue) !== budget.totalIncomeValue ||
    normalizeBudgetMoneyValue(budget.totalExpenseValue) !== budget.totalExpenseValue;
  if (!hasBudgetEnhancement) return result;

  return {
    ...result,
    data: {
      ...result.data,
      budgetLandscape: {
        ...budget,
        breakdown: breakdown.length ? breakdown : budget.breakdown,
        totalIncomeValue: normalizeBudgetMoneyValue(budget.totalIncomeValue),
        totalExpenseValue: normalizeBudgetMoneyValue(budget.totalExpenseValue),
        dataNeeded: budget.dataNeeded || "",
      },
    },
  };
}

async function resolveRegion(session: { region?: string; regionId?: string }) {
  const storage = getStorage();
  if (session.regionId) {
    const byId = await storage.getRegion(session.regionId);
    if (byId) return byId;
  }
  if (session.region) {
    const all = await storage.listRegions();
    const normalized = session.region.trim().toLowerCase();
    const canonical = canonicalRegionName(session.region, all);
    return (
      all.find((item) => item.name.toLowerCase() === normalized) ??
      all.find((item) => item.slug === normalized) ??
      all.find((item) => item.name === canonical) ??
      all.find((item) =>
        normalized.includes(item.slug) || item.name.toLowerCase().includes(normalized),
      ) ??
      null
    );
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const input = generateRequestSchema.parse(await request.json());
    if (!validateId(input.sessionId)) {
      return NextResponse.json({ error: "Invalid session ID" }, { status: 400 });
    }
    const storage = getStorage();
    const details = await storage.getSession(input.sessionId);
    if (!details) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const cacheDir = await getCacheDir();
    await Promise.all([
      fs.unlink(path.join(cacheDir, `${input.sessionId}.json`)).catch(() => undefined),
      fs.unlink(path.join(cacheDir, `${input.sessionId}.error.json`)).catch(() => undefined),
    ]);

    runGeneration(input.sessionId, input.prompt ?? "", details.session).catch((err) => {
      console.error(`[structured] Background generation failed for ${input.sessionId}:`, err);
    });

    return NextResponse.json({ status: "generating", sessionId: input.sessionId });
  } catch (error) {
    console.error("[structured] request failed:", error);
    return NextResponse.json({ error: "Generation failed" }, { status: 500 });
  }
}

async function runGeneration(sessionId: string, prompt: string, session: SessionProfile) {
  const cacheDir = await getCacheDir();
  const errorPath = path.join(cacheDir, `${sessionId}.error.json`);
  try {
    await clearProgress(sessionId);
    await writeProgress(sessionId, "storage", "Загрузка сессии", 2);

    const storage = getStorage();
    await writeProgress(sessionId, "playbooks", "Подбор релевантных правил", 5);
    const playbooks = await storage.listPlaybooks();
    const activePlaybooks = selectRelevantPlaybooks(session, playbooks);

    await writeProgress(sessionId, "region_context", "Чтение профиля региона", 8);
    const region = await resolveRegion(session);

    await writeProgress(sessionId, "memory_search", "Поиск в MemPalace", 12);
    const sberCatalog = await storage.listSberCatalog();
    const memories = await getMemoryClient().search(
      `${session.focusTopic ?? ""} ${session.region ?? ""} ${prompt}`,
    );

    await writeProgress(sessionId, "web_research", "Поиск открытых источников", 22);
    let webEvidence = await retrieveOpenSources({
      region: session.region,
      focusTopic: `${session.focusTopic ?? ""} ${prompt}`.trim(),
      limit: 10,
    });

    const regionCache = await readRegionCache(cacheKeyForRegion(session.regionId, session.region || ""));
    if (regionCache?.blocks.summary && webEvidence.length < 4) {
      const summaryEvidence = regionCache.blocks.summary.evidence;
      if (summaryEvidence.length) {
        webEvidence = [...summaryEvidence, ...webEvidence];
      }
    }

    await writeProgress(sessionId, "evidence_pack", "Извлечение подтверждённых фактов", 30);
    const generated = await generateStructured(
      session,
      activePlaybooks,
      region,
      memories,
      formatEvidenceForPrompt(webEvidence),
      prompt,
      sberCatalog,
      (percent, label) => {
        writeProgress(sessionId, "llm_generate", label, 30 + Math.round(percent * 0.5));
      },
    );

    await writeProgress(sessionId, "assembly", "Сборка и обогащение результата", 85);
    const result = await enhanceRegionOutput(generated, webEvidence);

    await writeProgress(sessionId, "save", "Сохранение результата", 95);
    await fs.unlink(errorPath).catch(() => undefined);
    await atomicWrite(
      path.join(cacheDir, `${sessionId}.json`),
      JSON.stringify(result),
    );

    await writeProgress(sessionId, "done", "Готово", 100);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await fs.mkdir(cacheDir, { recursive: true });
    await atomicWrite(
      errorPath,
      JSON.stringify({
        error: "Generation failed",
        message,
        at: new Date().toISOString(),
      }),
    );
    throw error;
  }
}
