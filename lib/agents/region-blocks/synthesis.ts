import type {
  RegionAnalysisOutput,
  RegionCoreThesis,
  RegionClaim,
  RegionStrategyRealityGap,
} from "@/lib/schemas/structured-output";
import { callLLM } from "@/lib/agents/llm-client";
import { tryParseJson } from "@/lib/utils/json";

const SYSTEM_PROMPT = `Ты — стратегический аналитик по работе с госсектором. На основе СОБРАННЫХ ФАКТОВ сделай СИНТЕЗ, а не пересказ. Верни СТРОГО JSON объект.

Правила: опирайся только на факты ниже; никаких выдуманных цифр, законов, ФИО; деловой русский, без англицизмов; НЕ пиши «нужно снять/проверить/уточнить»; soWhat и decision — конкретное управленческое действие, а не общие слова.

Верни объект строго по схеме:
{
  "coreThesis": {
    "headline": "Краткий парадоксальный тезис",
    "surfaceSignal": "Что видно на поверхности",
    "hiddenReality": "Что скрывается за сигналом",
    "soWhat": "Конкретное управленческое следствие"
  },
  "claims": [
    {
      "id": "claim-0",
      "metric": "Название показателя",
      "metricValue": 0,
      "direction": "up",
      "implication": "Что это означает",
      "decision": "Конкретное управленческое действие",
      "confidence": "high"
    }
  ],
  "strategyRealityGap": [
    {
      "id": "gap-0",
      "dimension": "Измерение разрыва",
      "strategyIntent": "Что зафиксировано в стратегии",
      "actualFact": "Что происходит на самом деле",
      "gapMagnitude": "Масштаб разрыва (опционально)"
    }
  ]
}

claims: 3–5 позиций, основанных на реальных числах из фактов. direction: "up" — рост, "down" — снижение, "flat" — стабильно. confidence: "high" | "medium" | "low". strategyRealityGap: 2–4 позиции.`;

function truncate(value: string | undefined | null, maxLen: number): string {
  if (!value) return "";
  return value.length > maxLen ? value.slice(0, maxLen) + "…" : value;
}

function buildFactsContext(output: RegionAnalysisOutput): string {
  const lines: string[] = [];

  // Карточка региона
  const rs = output.regionSummary;
  lines.push("=== КАРТОЧКА РЕГИОНА ===");
  lines.push(`Регион: ${rs.name}`);
  if (rs.federalDistrict) lines.push(`ФО: ${rs.federalDistrict}`);
  if (rs.population) lines.push(`Население: ${rs.population}`);
  if (rs.budgetTotal) lines.push(`Бюджет: ${rs.budgetTotal}`);
  if (rs.oneLiner) lines.push(`Суть: ${truncate(rs.oneLiner, 200)}`);

  // Бюджетный ландшафт
  const bl = output.budgetLandscape;
  if (bl) {
    lines.push("\n=== БЮДЖЕТ ===");
    if (bl.totalBudget) lines.push(`Итого: ${bl.totalBudget}`);
    if (bl.itShare) lines.push(`Доля ИТ: ${bl.itShare}`);
    const breakdownItems = (bl.breakdown ?? []).slice(0, 8);
    if (breakdownItems.length) {
      lines.push("Структура:");
      for (const item of breakdownItems) {
        const unit = item.unit ?? "млрд ₽";
        lines.push(`  ${truncate(item.name, 60)}: ${item.value} ${unit}`);
      }
    }
    if (bl.keyPrograms?.length) {
      const programNames = bl.keyPrograms
        .slice(0, 5)
        .map((p) => truncate(p.name, 60))
        .join("; ");
      lines.push(`Программы: ${programNames}`);
    }
  }

  // Отраслевая структура
  if (output.industryBreakdown?.length) {
    lines.push("\n=== ОТРАСЛИ ===");
    for (const ind of output.industryBreakdown.slice(0, 5)) {
      const enterprise = ind.keyEnterprises?.[0]?.name ?? "";
      const entPart = enterprise ? ` (${truncate(enterprise, 40)})` : "";
      lines.push(`  ${truncate(ind.name, 60)}${entPart}`);
    }
  }

  // Стратегические приоритеты
  if (output.strategicPriorities?.confirmed?.length) {
    lines.push("\n=== ПРИОРИТЕТЫ (подтверждённые) ===");
    for (const p of output.strategicPriorities.confirmed.slice(0, 5)) {
      lines.push(`  - ${truncate(p, 100)}`);
    }
  }

  // Сценарии
  if (output.regionalScenarios?.length) {
    lines.push("\n=== СЦЕНАРИИ ===");
    for (const sc of output.regionalScenarios.slice(0, 3)) {
      lines.push(
        `  ${truncate(sc.title, 60)} · ${sc.probability} · триггер: ${truncate(sc.trigger, 80)}`,
      );
    }
  }

  return lines.join("\n");
}

interface SynthesisRaw {
  coreThesis?: Partial<RegionCoreThesis>;
  claims?: Partial<RegionClaim>[];
  strategyRealityGap?: Partial<RegionStrategyRealityGap>[];
}

function coerceCoreThesis(raw: Partial<RegionCoreThesis> | undefined): RegionCoreThesis | undefined {
  if (!raw) return undefined;
  if (!raw.headline?.trim() || !raw.soWhat?.trim()) return undefined;
  return {
    headline: raw.headline.trim(),
    surfaceSignal: raw.surfaceSignal?.trim() ?? "",
    hiddenReality: raw.hiddenReality?.trim() ?? "",
    soWhat: raw.soWhat.trim(),
  };
}

function coerceClaims(raw: Partial<RegionClaim>[] | undefined): RegionClaim[] {
  if (!Array.isArray(raw)) return [];
  const result: RegionClaim[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item?.metric?.trim() || !item?.implication?.trim() || !item?.decision?.trim()) continue;
    const validDirections = new Set(["up", "down", "flat"]);
    const validConfidence = new Set(["high", "medium", "low"]);
    result.push({
      id: item.id?.trim() || `claim-${i}`,
      metric: item.metric.trim(),
      metricValue: typeof item.metricValue === "number" ? item.metricValue : undefined,
      direction: validDirections.has(item.direction ?? "") ? (item.direction as RegionClaim["direction"]) : undefined,
      implication: item.implication.trim(),
      decision: item.decision.trim(),
      confidence: validConfidence.has(item.confidence ?? "") ? (item.confidence as RegionClaim["confidence"]) : undefined,
    });
  }
  return result;
}

function coerceGaps(raw: Partial<RegionStrategyRealityGap>[] | undefined): RegionStrategyRealityGap[] {
  if (!Array.isArray(raw)) return [];
  const result: RegionStrategyRealityGap[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item?.dimension?.trim() || !item?.strategyIntent?.trim() || !item?.actualFact?.trim()) continue;
    result.push({
      id: item.id?.trim() || `gap-${i}`,
      dimension: item.dimension.trim(),
      strategyIntent: item.strategyIntent.trim(),
      actualFact: item.actualFact.trim(),
      gapMagnitude: item.gapMagnitude?.trim() || undefined,
    });
  }
  return result;
}

export async function synthesizeRegionInsights(output: RegionAnalysisOutput): Promise<{
  coreThesis?: RegionCoreThesis;
  claims?: RegionClaim[];
  strategyRealityGap?: RegionStrategyRealityGap[];
}> {
  try {
    const facts = buildFactsContext(output);

    const raw = await callLLM({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: facts },
      ],
      temperature: 0.2,
      maxTokens: 2000,
      responseFormat: "json_object",
    });

    const parsed = tryParseJson<SynthesisRaw>(raw);

    const coreThesis = coerceCoreThesis(parsed.coreThesis);
    const claims = coerceClaims(parsed.claims);
    const strategyRealityGap = coerceGaps(parsed.strategyRealityGap);

    return {
      coreThesis: coreThesis ?? undefined,
      claims: claims.length ? claims : undefined,
      strategyRealityGap: strategyRealityGap.length ? strategyRealityGap : undefined,
    };
  } catch (err) {
    console.warn("[blocks][synthesis] failed", err);
    return {};
  }
}
