import puppeteer from "puppeteer";
import type { AgentOutput } from "@/lib/schemas/output";
import type { RegionAnalysisOutput, TypedOutput } from "@/lib/schemas/structured-output";
import { cleanSourceText } from "@/lib/quality/meeting-output-quality";

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function compact(value: string | undefined, limit = 180) {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trim()}…` : text;
}

function isRegionOutput(output: TypedOutput | null): output is { kind: "region"; data: RegionAnalysisOutput } {
  return output?.kind === "region" && Boolean(output.data);
}

export function toRegionAgentOutput(output: TypedOutput, sessionId: string): AgentOutput | null {
  if (!isRegionOutput(output)) return null;
  const data = output.data;
  const budget = data.budgetLandscape;
  const budgetLines = [
    budget?.totalBudget ? `Общий бюджет: ${budget.totalBudget}` : "",
    ...(budget?.breakdown ?? [])
      .slice()
      .sort((a, b) => b.value - a.value)
      .slice(0, 6)
      .map((item) => `${item.name}: ${item.value.toLocaleString("ru-RU")} ${item.unit ?? "млрд ₽"}`),
  ].filter(Boolean);

  const sections = [
    {
      id: "thesis",
      title: "Ключевой тезис",
      type: "text" as const,
      content: [
        data.coreThesis?.headline,
        data.coreThesis?.surfaceSignal,
        data.coreThesis?.hiddenReality,
        data.coreThesis?.soWhat,
      ].filter(Boolean).join("\n"),
    },
    {
      id: "budget",
      title: "Бюджет и программы",
      type: "metrics" as const,
      content: budgetLines.join("\n"),
    },
    {
      id: "industries",
      title: "Отраслевая структура",
      type: "table" as const,
      content: (data.industryBreakdown ?? [])
        .slice(0, 5)
        .map((item) => `${item.name}: ${(item.keyEnterprises ?? []).slice(0, 2).map((e) => e.name).join(", ") || "требуется добор предприятий"}`)
        .join("\n"),
    },
    {
      id: "priorities",
      title: "Приоритеты на 5 лет",
      type: "roadmap" as const,
      content: (data.strategicPriorities?.roadmap ?? [])
        .slice(0, 6)
        .map((item) => `${item.period}: ${item.title}`)
        .join("\n"),
    },
    {
      id: "scenarios",
      title: "Сценарии развития",
      type: "risks" as const,
      content: (data.regionalScenarios ?? [])
        .slice(0, 4)
        .map((item) => `${item.title}: ${compact(item.trigger, 140)}`)
        .join("\n"),
    },
  ];

  return {
    id: `export_${sessionId}`,
    sessionId,
    title: `Анализ региона: ${data.regionSummary?.name || "регион"}`,
    type: "region",
    summary: compact(data.regionSummary?.oneLiner || data.coreThesis?.headline || "", 500),
    sections,
    recommendations: (data.strategicPriorities?.confirmed ?? []).slice(0, 5),
    risks: (data.dataGaps ?? []).slice(0, 5).map((gap) => gap.question),
    nextSteps: (data.regionalScenarios ?? []).slice(0, 3).map((scenario) => `Мониторить сценарий: ${scenario.title}`),
    markdown: "",
    createdAt: new Date().toISOString(),
    sources: (data.sources ?? []).slice(0, 12).map((source) => ({
      title: cleanSourceText(source.title),
      type: "external_required" as const,
      excerpt: cleanSourceText(source.excerpt ?? ""),
      status: source.isVerified ? "used" as const : "needs_check" as const,
      url: source.url,
    })),
  };
}

export function buildRegionHtml(output: TypedOutput, meta: string[] = []): string | null {
  if (!isRegionOutput(output)) return null;
  const data = output.data;
  const budget = data.budgetLandscape;
  const expenses = (budget?.breakdown ?? [])
    .filter((item) => item.kind === "expense" && Number.isFinite(item.value) && item.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 7);
  const max = Math.max(...expenses.map((item) => item.value), 1);

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <style>
    @page { size: A4; margin: 18mm; }
    body { font-family: Inter, Arial, sans-serif; color: #111; background: #fff; }
    .eyebrow { color: #6b7280; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; }
    h1 { font-size: 28px; margin: 8px 0 10px; }
    h2 { font-size: 16px; margin: 22px 0 10px; }
    p { font-size: 11px; line-height: 1.45; margin: 0; }
    .hero { border: 1px solid #e5e7eb; border-radius: 18px; padding: 18px; background: linear-gradient(135deg,#f8fafc,#fff); }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .card { border: 1px solid #e5e7eb; border-radius: 14px; padding: 12px; break-inside: avoid; }
    .metric { font-size: 18px; font-weight: 800; margin-top: 4px; }
    .muted { color: #6b7280; }
    .bar-row { display: grid; grid-template-columns: 120px 1fr 80px; gap: 8px; align-items: center; margin: 8px 0; font-size: 10px; }
    .track { height: 7px; background: #eef2f7; border-radius: 999px; overflow: hidden; }
    .fill { height: 100%; background: linear-gradient(90deg,#111,#10b981); border-radius: 999px; }
    .tag { display: inline-block; border: 1px solid #e5e7eb; border-radius: 999px; padding: 3px 8px; font-size: 10px; margin: 2px 4px 2px 0; }
    .section { page-break-inside: avoid; }
  </style>
</head>
<body>
  <div class="hero">
    <div class="eyebrow">${esc(meta.join(" · ") || "Региональный анализ")}</div>
    <h1>${esc(data.regionSummary?.name || "Регион")}</h1>
    <p>${esc(compact(data.regionSummary?.oneLiner || data.coreThesis?.headline || "", 360))}</p>
    <div class="grid" style="margin-top:14px">
      <div class="card"><div class="eyebrow">Население</div><div class="metric">${esc(data.regionSummary?.population || "—")}</div></div>
      <div class="card"><div class="eyebrow">Бюджет</div><div class="metric">${esc(data.regionSummary?.budgetTotal || budget?.totalBudget || "—")}</div></div>
    </div>
  </div>

  ${data.coreThesis ? `<div class="section"><h2>Ключевой тезис</h2><div class="card"><p><b>${esc(data.coreThesis.headline)}</b></p><p class="muted" style="margin-top:6px">${esc(compact(data.coreThesis.soWhat, 320))}</p></div></div>` : ""}

  <div class="section"><h2>Бюджетный ландшафт</h2><div class="card">
    ${expenses.map((item) => `<div class="bar-row"><span>${esc(item.name)}</span><div class="track"><div class="fill" style="width:${Math.max(4, Math.round((item.value / max) * 100))}%"></div></div><b>${esc(item.value.toLocaleString("ru-RU"))} ${esc(item.unit || "млрд ₽")}</b></div>`).join("")}
  </div></div>

  <div class="grid">
    <div class="section"><h2>Отрасли</h2>${(data.industryBreakdown ?? []).slice(0, 5).map((item) => `<div class="card"><p><b>${esc(item.name)}</b></p><p class="muted">${esc((item.keyEnterprises ?? []).slice(0, 2).map((e) => e.name).join(", "))}</p></div>`).join("")}</div>
    <div class="section"><h2>Сценарии</h2>${(data.regionalScenarios ?? []).slice(0, 4).map((item) => `<div class="card"><p><b>${esc(item.title)}</b></p><p class="muted">${esc(compact(item.trigger, 180))}</p></div>`).join("")}</div>
  </div>

  <div class="section"><h2>Приоритеты на 5 лет</h2><div class="card">
    ${(data.strategicPriorities?.roadmap ?? []).slice(0, 6).map((item) => `<span class="tag">${esc(item.period)} · ${esc(item.title)}</span>`).join("")}
  </div></div>

  <div class="section"><h2>Источники</h2><div class="card">${(data.sources ?? []).slice(0, 10).map((source) => `<p class="muted">• ${esc(cleanSourceText(source.title))}${source.url ? ` — ${esc(source.url)}` : ""}</p>`).join("")}</div></div>
</body>
</html>`;
}

export async function buildRegionPdf(output: TypedOutput, meta: string[] = []): Promise<Uint8Array | null> {
  const html = buildRegionHtml(output, meta);
  if (!html) return null;
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const buffer = await page.pdf({ format: "A4", printBackground: true });
    return new Uint8Array(buffer);
  } finally {
    await browser.close();
  }
}
