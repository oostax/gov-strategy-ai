import type { PrioritiesBlockOutput } from "../types";
import type { BlockDeps } from "../types";
import { prepareBlockSources, callBlockLLM, parseBlockJson, refineByAgentInstructions, normalizeHypotheses, buildContextPreamble } from "./base";

const SYSTEM_PROMPT = `Ты — аналитик региональной стратегии. Извлеки стратегические приоритеты региона из источников.

Правила:
- confirmed: приоритеты, прямо подтверждённые в стратегии СЭР, указах губернатора, нацпроектах.
- hypothesized: приоритеты, логически вытекающие из источников, но не заявленные явно.
- source: документ, из которого взяты приоритеты (название, дата, ссылка).
- roadmap: приоритеты на 5 лет с периодами и привязкой к программам.
- Не выдумывай приоритеты. Только из источников.
- Если стратегия или программа не найдена, оставь массивы пустыми и добавь вопрос в hypotheses.
- Верни ТОЛЬКО JSON.

Схема:
{
  "strategicPriorities": {
    "confirmed": ["приоритет с источником"],
    "hypothesized": ["предполагаемый приоритет"],
    "source": "откуда взяты",
    "roadmap": [
      {"id":"pr_1","title":"","period":"2025–2026","linkedProgram":"","source":""}
    ]
  },
  "sources": [],
  "hypotheses": []
}`;

function normalizePriorityList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    const text =
      typeof item === "string"
        ? item
        : item && typeof item === "object"
          ? [
              (item as Record<string, unknown>).title,
              (item as Record<string, unknown>).statement,
              (item as Record<string, unknown>).priority,
              (item as Record<string, unknown>).name,
            ].find((part): part is string => typeof part === "string" && part.trim().length > 0)
          : "";
    if (text?.trim()) result.push(text.trim());
  }
  return Array.from(new Set(result)).slice(0, 8);
}

export async function generatePrioritiesBlock(
  deps: BlockDeps,
  searchQueries: string[],
): Promise<PrioritiesBlockOutput> {
  const { webEvidence: initialWebEvidence, sources } = await prepareBlockSources(
    deps,
    searchQueries,
    { kind: "priorities" },
  );
  let webEvidence = initialWebEvidence;

  if (deps.priorBlocks?.length) {
    const budgetData = deps.priorBlocks.find(b => b.kind === "budget")?.data as Record<string, unknown> | undefined;
    if (budgetData?.budgetLandscape) {
      webEvidence += `\n\n--- Данные бюджета ---\n${JSON.stringify(budgetData.budgetLandscape).slice(0, 2000)}`;
    }
  }

  const userMessage = [
    `Регион: ${deps.region}`,
    `Тема: ${deps.focusTopic}`,
    "",
    buildContextPreamble(deps),
    "",
    `Источники:\n${webEvidence}`,
    "",
    "Извлеки стратегические приоритеты региона: что регион планирует развивать в ближайшие 5 лет.",
    "Привязывай к национальным проектам и официальным программам региона.",
  ].join("\n");

  const raw = await callBlockLLM(SYSTEM_PROMPT, userMessage, deps.agentInstructions, { sessionId: deps.session.id, runId: deps.runId, label: "priorities" });
  let parsed = parseBlockJson(raw) as PrioritiesBlockOutput;

  parsed = await refineByAgentInstructions(parsed, "Стратегические приоритеты", SYSTEM_PROMPT, userMessage, deps.agentInstructions);

  return {
    strategicPriorities: {
      confirmed: normalizePriorityList(parsed.strategicPriorities?.confirmed),
      hypothesized: normalizePriorityList(parsed.strategicPriorities?.hypothesized).slice(0, 5),
      source: parsed.strategicPriorities?.source || "",
      roadmap: (parsed.strategicPriorities?.roadmap || []).slice(0, 8),
    },
    sources: [...(parsed.sources || []), ...sources],
    hypotheses: normalizeHypotheses(parsed.hypotheses),
  };
}
