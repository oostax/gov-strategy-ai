import type { ScenariosBlockOutput } from "../types";
import type { BlockDeps } from "../types";
import { prepareBlockSources, callBlockLLM, parseBlockJson, assertMinItems, refineByAgentInstructions, normalizeHypotheses, buildContextPreamble } from "./base";

const SYSTEM_PROMPT = `Ты — сценарный аналитик. Составь 3-4 сценария развития региона на 5 лет.

Правила:
- Сценарий — это НЕ продукты Сбера, а логика развития региона.
- Разные типы: базовый бюджетный, ускоренный/инвестиционный, стрессовый, отраслевой поворот.
- trigger: конкретное событие, запускающее сценарий.
- budgetImplication: как меняется бюджет.
- sberPosture: заполняй только для taskType="sber_region_strategy"; для taskType="region_strategy" оставь пустым.
- Любая цифра — только из источника.
- Не придумывай федеральные законы, поправки, цены сырья, годы принятия документов и точные пороги. Если источника нет, формулируй триггер качественно: изменение бюджетной рамки, изменение федерального финансирования, запуск подтвержденной программы, ухудшение отраслевой конъюнктуры.
- В hypotheses не помещай точные числа, проценты, цены, годы принятия законов и названия организаций без источника.
- Верни ТОЛЬКО JSON.

Схема:
{
  "regionalScenarios": [
    {
      "id": "sc_1",
      "title": "Название сценария",
      "probability": "high",
      "horizon": "2026–2030",
      "trigger": "Что должно случиться",
      "regionMoves": ["Что делает регион"],
      "budgetImplication": "Как меняется бюджет",
      "industryImpact": "Какие отрасли выигрывают",
      "sberPosture": "Позиция Сбера",
      "earlySignals": ["Что мониторить"]
    }
  ],
  "sources": [],
  "hypotheses": []
}`;

export async function generateScenariosBlock(
  deps: BlockDeps,
  searchQueries: string[],
): Promise<ScenariosBlockOutput> {
  const { webEvidence, sources } = await prepareBlockSources(
    deps,
    searchQueries,
    { kind: "scenarios" },
  );

  const userMessage = [
    `Регион: ${deps.region}`,
    `Тема: ${deps.focusTopic}`,
    `Тип сессии: ${deps.session.taskType}`,
    "",
    buildContextPreamble(deps),
    "",
    `Источники:\n${webEvidence}`,
    "",
    "Составь 3-4 сценария развития региона на 5 лет, используя данные из источников.",
    "Сценарии должны различаться по логике развития и опираться на реальные данные региона.",
  ].join("\n");

  const raw = await callBlockLLM(SYSTEM_PROMPT, userMessage, deps.agentInstructions, { sessionId: deps.session.id, runId: deps.runId, label: "block" });
  let parsed = parseBlockJson(raw) as ScenariosBlockOutput;
  assertMinItems(
    parsed.regionalScenarios,
    3,
    "Недостаточно сценариев: нужно минимум 3 разных сценария развития региона",
  );
  parsed = await refineByAgentInstructions(parsed, "Сценарии развития", SYSTEM_PROMPT, userMessage, deps.agentInstructions);

  return {
    regionalScenarios: (parsed.regionalScenarios || []).slice(0, 4).map((scenario) => ({
      ...scenario,
      sberPosture: deps.session.taskType === "sber_region_strategy" ? scenario.sberPosture : "",
    })),
    sources: [...(parsed.sources || []), ...sources],
    hypotheses: normalizeHypotheses(parsed.hypotheses),
  };
}
