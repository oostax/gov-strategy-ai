import type {
  RegionAnalysisOutput,
  Source,
  TypedOutput,
} from "@/lib/schemas/structured-output";
import { sanitizeRegionOutput } from "@/lib/agents/fact-guard";
import { BLOCK_ORDER, type BlockKind } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeKey(value: Source) {
  return (value.url || value.title || "").trim().replace(/\/$/, "").toLowerCase();
}

function appendSources(target: Source[], value: unknown) {
  if (!Array.isArray(value)) return;
  const seen = new Set(target.map(normalizeKey));
  for (const item of value) {
    if (!isRecord(item) || typeof item.title !== "string") continue;
    const source: Source = {
      title: item.title,
      url: typeof item.url === "string" ? item.url : undefined,
      excerpt: typeof item.excerpt === "string" ? item.excerpt : "",
      isVerified: item.isVerified === true,
    };
    if (!isUsefulSource(source)) continue;
    const key = normalizeKey(source);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    target.push(source);
  }
}

function isUsefulSource(source: Source) {
  const text = `${source.title} ${source.url ?? ""} ${source.excerpt ?? ""}`.toLowerCase();
  if (/awdb\.ru|russiametrics\.ru/.test(text)) return false;
  if (/ru\.wikipedia\.org/.test(text) && (/\([^)]*(область|край|республика)[^)]*\)/i.test(text) || !/население|экономик|бюджет|стратег|субъект/i.test(text))) {
    return false;
  }
  if (/consultant\.ru/.test(text) && !/област|край|республик|бюджет|стратег/i.test(text)) return false;
  return true;
}

function appendHypotheses(target: string[], value: unknown) {
  if (!Array.isArray(value)) return;
  const seen = new Set(target.map((item) => item.toLowerCase().trim()));
  for (const item of value) {
    const text = typeof item === "string"
      ? item
      : isRecord(item) && typeof item.statement === "string"
        ? item.statement
        : isRecord(item) && typeof item.title === "string"
          ? item.title
          : "";
    const normalized = text.trim();
    const key = normalized.toLowerCase();
    if (/^(неизвестно|неясно|отсутствуют|не указаны|нет сведений|требуется уточнить)/i.test(normalized)) continue;
    if (/\d[\d\s,.]*(%|процент|млрд|млн|тыс|₽|руб)/i.test(normalized)) continue;
    if (/\b(usd|баррел|доллар|например|и др\.|поправк|федеральн(?:ый|ого)\s+закон|принят[а-я]*\s+в\s+\d{4})\b/i.test(normalized)) continue;
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    target.push(normalized);
  }
}

function isActionableQuestion(value: string) {
  const text = value.trim();
  if (!text) return false;
  if (/[?？]/.test(text)) return true;
  return /^(по .* нужно|нужно|проверить|добрать|уточнить|подтвердить|найти|какие|какой|какая|кто|где|сколько|перечень|источник)/i.test(text);
}

function looksLikeEmptyAnalysis(value: string) {
  return /в (?:представленных )?источниках нет|нет (?:конкретных |прямых )?(?:данных|сведений|упоминаний)|не содержит данных|не содержит сведений|без детализации|нет прямого упоминания|не раскрыт|требует уточнения|не найдено/i.test(value);
}

function mergeBlockData(
  collected: Partial<RegionAnalysisOutput>,
  kind: BlockKind,
  data: unknown,
) {
  if (!isRecord(data)) return;

  if (kind === "summary") {
    if (isRecord(data.regionSummary)) collected.regionSummary = data.regionSummary as unknown as RegionAnalysisOutput["regionSummary"];
    if (isRecord(data.coreThesis)) collected.coreThesis = data.coreThesis as unknown as RegionAnalysisOutput["coreThesis"];
  }
  if (kind === "budget" && isRecord(data.budgetLandscape)) {
    collected.budgetLandscape = data.budgetLandscape as unknown as RegionAnalysisOutput["budgetLandscape"];
  }
  if (kind === "industries" && Array.isArray(data.industryBreakdown)) {
    collected.industryBreakdown = data.industryBreakdown as RegionAnalysisOutput["industryBreakdown"];
  }
  if (kind === "priorities" && isRecord(data.strategicPriorities)) {
    collected.strategicPriorities = data.strategicPriorities as RegionAnalysisOutput["strategicPriorities"];
  }
  if (kind === "scenarios" && Array.isArray(data.regionalScenarios)) {
    collected.regionalScenarios = data.regionalScenarios as RegionAnalysisOutput["regionalScenarios"];
  }
  if (kind === "competition" && Array.isArray(data.competitiveLandscape)) {
    collected.competitiveLandscape = data.competitiveLandscape
      .map((item) => normalizeCompetitor(item))
      .filter((item): item is NonNullable<ReturnType<typeof normalizeCompetitor>> => item !== null);
  }
  if (kind === "stakeholders" && Array.isArray(data.stakeholderMap)) {
    collected.stakeholderMap = data.stakeholderMap as RegionAnalysisOutput["stakeholderMap"];
  }
}

export function assembleRegionBlocks({
  regionName,
  blocks,
}: {
  regionName: string;
  blocks: Array<{ kind: BlockKind; data: unknown }>;
}): RegionAnalysisOutput {
  const collected: Partial<RegionAnalysisOutput> = {};
  const sources: Source[] = [];
  const hypotheses: string[] = [];

  for (const kind of BLOCK_ORDER) {
    const block = blocks.find((item) => item.kind === kind);
    if (!block) continue;
    mergeBlockData(collected, kind, block.data);
    if (isRecord(block.data)) {
      appendSources(sources, block.data.sources);
      appendHypotheses(hypotheses, block.data.hypotheses);
    }
  }

  const assembled = sanitizeRegionOutput({
    regionSummary: collected.regionSummary || {
      name: regionName,
      federalDistrict: "",
      population: "",
      budgetTotal: "",
      oneLiner: "",
    },
    coreThesis: collected.coreThesis,
    industryBreakdown: collected.industryBreakdown || [],
    budgetLandscape: collected.budgetLandscape || {
      totalBudget: "",
      itShare: "",
      keyPrograms: [],
      upcomingTenders: "",
      dataNeeded: "",
    },
    regionalScenarios: collected.regionalScenarios || [],
    stakeholderMap: collected.stakeholderMap || [],
    competitiveLandscape: collected.competitiveLandscape || [],
    entryPoints: [],
    strategicPriorities: collected.strategicPriorities || {
      confirmed: [],
      hypothesized: [],
      source: "",
    },
    dataGaps: [],
    risks: [],
    nextSteps: [],
    sources,
    hypotheses,
  });
  return repairCrossBlockContradictions(assembled, regionName);
}

function repairCrossBlockContradictions(output: RegionAnalysisOutput, regionName: string): RegionAnalysisOutput {
  const totalBudget = output.budgetLandscape?.totalBudget?.trim();
  if (totalBudget && !output.regionSummary.budgetTotal?.trim()) {
    output.regionSummary.budgetTotal = totalBudget;
  }
  if (totalBudget && /бюджет[а-я\s]*нет|отсутств/i.test(output.regionSummary.oneLiner || "")) {
    const industries = output.industryBreakdown
      .map((item) => item.name)
      .filter(Boolean)
      .slice(0, 3)
      .join(", ");
    output.regionSummary.oneLiner = [
      `${regionName}: бюджетная рамка ${totalBudget}`,
      industries ? `ключевые отрасли: ${industries}` : "",
    ].filter(Boolean).join("; ");
  }
  const actionableHypotheses = output.hypotheses
    .filter((item) => !looksLikeEmptyAnalysis(item))
    .filter(isActionableQuestion)
    .slice(0, 6);

  if (!output.dataGaps.length && actionableHypotheses.length) {
    output.dataGaps = actionableHypotheses.map((question, index) => ({
      id: `gap_${index + 1}`,
      question,
      howToGet: "Добрать через официальный документ, региональный портал, Росстат или закупочный контур.",
      priority: index < 3 ? "high" : "medium",
      owner: "",
    }));
  }
  output.dataGaps = (output.dataGaps || []).filter((gap) =>
    isActionableQuestion(gap.question || "") && !looksLikeEmptyAnalysis(gap.question || ""),
  );
  output.industryBreakdown = (output.industryBreakdown || []).map((industry) => ({
    ...industry,
    currentDigitalState: looksLikeEmptyAnalysis(industry.currentDigitalState || "") ? "" : industry.currentDigitalState,
    limitations: (industry.limitations || []).filter((item) => !looksLikeEmptyAnalysis(item)),
  }));
  output.regionalScenarios = (output.regionalScenarios || []).map((scenario) => {
    const hasEvidence = Boolean(scenario.evidence?.length || scenario.sources?.length);
    const trigger = scenario.trigger || "";
    const looksOverprecise =
      /\b(поправк|федеральн(?:ый|ого)\s+закон|принят[а-я]*\s+в\s+\d{4}|usd|баррел|ниже\s+\d|выше\s+\d)\b/i.test(trigger);
    if (!hasEvidence && looksOverprecise) {
      return {
        ...scenario,
        trigger: "Изменение бюджетных, инвестиционных или отраслевых условий, подтверждаемое обновлением официальных документов региона.",
      };
    }
    return {
      ...scenario,
      trigger: cleanScenarioText(trigger),
      regionMoves: (scenario.regionMoves || []).map(cleanScenarioText),
      budgetImplication: cleanScenarioText(scenario.budgetImplication || ""),
      industryImpact: cleanScenarioText(scenario.industryImpact || ""),
      earlySignals: (scenario.earlySignals || []).map(cleanScenarioText),
    };
  });
  return output;
}

function normalizeCompetitor(value: unknown): RegionAnalysisOutput["competitiveLandscape"][number] | null {
  if (!isRecord(value)) return null;
  const vendor = stringValue(value.vendor) || stringValue(value.name);
  const product = stringValue(value.product) || stringValue(value.category) || stringValue(value.solution);
  const evidence = stringValue(value.evidence);
  if (!vendor || !evidence) return null;
  return {
    ...((value as unknown) as RegionAnalysisOutput["competitiveLandscape"][number]),
    id: stringValue(value.id) || `comp_${vendor.toLowerCase().replace(/[^a-zа-я0-9]+/gi, "_").slice(0, 24)}`,
    vendor,
    product,
    where: stringValue(value.where) || stringValue(value.incumbentPosition),
    stage: stringValue(value.stage),
    threatLevel: stringValue(value.threatLevel) || "",
    evidence,
    incumbentPosition: stringValue(value.incumbentPosition) || stringValue(value.where),
    decisionCriteria: Array.isArray(value.decisionCriteria)
      ? value.decisionCriteria.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [],
    riskForSber: stringValue(value.riskForSber),
    sberCounterPosition: stringValue(value.sberCounterPosition) || stringValue(value.sberAdvantage),
    nextCheck: stringValue(value.nextCheck),
  };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanScenarioText(value: string): string {
  return value
    .replace(/\s*\((?:например|одобренн)[^)]+\)/gi, "")
    .replace(/\bнапример,\s*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function assertRegionOutputReady(output: RegionAnalysisOutput) {
  // Жёсткие требования: регион опознан и есть источники.
  const hardIssues: string[] = [];
  if (!output.regionSummary?.name?.trim()) hardIssues.push("regionSummary.name missing");
  if (!output.sources?.length) hardIssues.push("sources empty");

  // Содержательные блоки: адаптивная композиция допускает разный состав, поэтому
  // не требуем КАЖДЫЙ блок — достаточно значимого минимума. Один пустой блок
  // (напр. приоритеты) не должен ронять всю сессию: пустые секции просто скрываются.
  const budgetOk = Boolean(
    output.budgetLandscape &&
    (output.budgetLandscape.totalBudget ||
      output.budgetLandscape.breakdown?.length ||
      output.budgetLandscape.totalIncomeValue),
  );
  const populatedContentBlocks = [
    (output.industryBreakdown?.length ?? 0) > 0,
    budgetOk,
    (output.regionalScenarios?.length ?? 0) > 0,
    Boolean(output.strategicPriorities?.confirmed?.length || output.strategicPriorities?.roadmap?.length),
  ].filter(Boolean).length;

  if (populatedContentBlocks < 2) {
    hardIssues.push(`too few content blocks (${populatedContentBlocks}/4)`);
  }

  if (hardIssues.length) {
    throw new Error(`Block output is not ready: ${hardIssues.join(", ")}`);
  }
}

export function toTypedRegionOutput(output: RegionAnalysisOutput): TypedOutput {
  assertRegionOutputReady(output);
  return { kind: "region", data: output };
}
