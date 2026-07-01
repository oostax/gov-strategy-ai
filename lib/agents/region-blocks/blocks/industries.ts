import type { IndustriesBlockOutput } from "../types";
import type { BlockDeps } from "../types";
import { prepareBlockSources, callBlockLLM, parseBlockJson, assertMinItems, refineByAgentInstructions, normalizeHypotheses, buildContextPreamble } from "./base";

const SYSTEM_PROMPT = `Ты — отраслевой аналитик. Составь структуру экономики региона.

Правила:
- 3-5 ключевых отраслей.
- keyEnterprises: 2-3 конкретных предприятия на отрасль с названием и описанием. Не "крупные агрохолдинги", а конкретные названия.
- currentDigitalState: что реально цифровизировано (из источников), не гипотезы.
- limitations: конкретные ограничения отрасли (без воды).
- sberRelevance: заполняй только для taskType="sber_region_strategy"; для taskType="region_strategy" оставь пустым.
- Не выдумывай названия предприятий. Если нет в источнике — оставь keyEnterprises пустым и добавь вопрос в hypotheses.
- Не пиши "требует уточнения", "не указано", "отсутствует" внутри аналитических полей.
- Если по цифровизации отрасли нет конкретного подтверждённого факта, оставь currentDigitalState пустым. Не пиши фразы вида "в источниках нет данных".
- Не используй англицизмы и латинские сокращения. Пиши по-русски: система планирования ресурсов, диспетчерское управление, датчики и промышленный интернет.
- Верни ТОЛЬКО JSON.

Схема:
{
  "industryBreakdown": [
    {
      "id":"ind_1",
      "name":"Отрасль",
      "keyEnterprises": [
        {"name":"Название предприятия","description":"краткое описание"}
      ],
      "currentDigitalState":"Что цифровизировано",
      "limitations":["ограничение 1","ограничение 2"],
      "sberRelevance":"Конкретная релевантность для Сбера"
    }
  ],
  "sources": [],
  "hypotheses": []
}`;

export async function generateIndustriesBlock(
  deps: BlockDeps,
  searchQueries: string[],
): Promise<IndustriesBlockOutput> {
  let { webEvidence, sources } = await prepareBlockSources(
    deps,
    searchQueries,
    { kind: "industries" },
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
    "Выдели 3-5 ключевых отраслей экономики региона из источников.",
    "Для каждой укажи только подтверждённые предприятия с названиями и ограничения.",
    "Состояние цифровизации заполняй только при наличии конкретного факта из источника; иначе оставь поле пустым.",
    "Не используй проценты и доли ВРП если их нет в источнике.",
  ].join("\n");

  let raw = await callBlockLLM(SYSTEM_PROMPT, userMessage, deps.agentInstructions, { sessionId: deps.session.id, runId: deps.runId, label: "industries" });
  let parsed = parseBlockJson(raw) as IndustriesBlockOutput;
  if (!Array.isArray(parsed.industryBreakdown) || parsed.industryBreakdown.length < 3) {
    ({ webEvidence, sources } = await prepareBlockSources(
      deps,
      [
        `${deps.region} структура экономики ВРП отрасли`,
        `${deps.region} промышленность сельское хозяйство строительство торговля статистика`,
        `${deps.region} социально-экономическое положение отрасли`,
      ],
      { kind: "industries", skipCache: true },
    ));
    raw = await callBlockLLM(
      SYSTEM_PROMPT,
      [
        `Регион: ${deps.region}`,
        `Тема: ${deps.focusTopic}`,
        "",
        buildContextPreamble(deps),
        "",
        `Источники:\n${webEvidence}`,
        "",
        "Предыдущий поиск дал недостаточно фактуры.",
        "Выдели 3-5 ключевых отраслей с конкретными предприятиями.",
      ].join("\n"),
      deps.agentInstructions,
      { sessionId: deps.session.id, runId: deps.runId, label: "industries_fallback" },
    );
    parsed = parseBlockJson(raw) as IndustriesBlockOutput;
  }
  assertMinItems(
    parsed.industryBreakdown,
    3,
    "Недостаточно отраслевой фактуры: нужно минимум 3 отрасли из источников",
  );
  parsed = sanitizeIndustries(
    await refineByAgentInstructions(parsed, "Отраслевая структура", SYSTEM_PROMPT, userMessage, deps.agentInstructions),
    deps.session.taskType,
  );

  return {
    industryBreakdown: (parsed.industryBreakdown || []).slice(0, 5),
    sources: [...(parsed.sources || []), ...sources],
    hypotheses: normalizeHypotheses(parsed.hypotheses),
  };
}

function sanitizeIndustries(parsed: IndustriesBlockOutput, taskType: string): IndustriesBlockOutput {
  const gaps = normalizeHypotheses(parsed.hypotheses);
  const industryBreakdown = (parsed.industryBreakdown || []).map((industry) => {
    const keyEnterprises = (industry.keyEnterprises || []).filter((enterprise) => {
      const text = `${enterprise.name} ${enterprise.description}`.toLowerCase();
      return !/требу[её]т уточнения|не указано|отсутствует|нет данных/.test(text);
    });
    if (!keyEnterprises.length) {
      gaps.push(`По отрасли "${industry.name}" нужно добрать перечень крупнейших предприятий из региональной стратегии, статистического сборника или реестра промышленных предприятий.`);
    }
    const currentDigitalState = cleanUnconfirmedText(industry.currentDigitalState);
    const limitations = (industry.limitations || [])
      .map(cleanUnconfirmedText)
      .filter((item): item is string => Boolean(item));

    return {
      ...industry,
      keyEnterprises,
      currentDigitalState: currentDigitalState || "",
      limitations,
      sberRelevance: taskType === "sber_region_strategy" ? cleanUnconfirmedText(industry.sberRelevance) || "" : "",
    };
  }).filter((industry) =>
    industry.keyEnterprises.length > 0 ||
    Boolean(industry.currentDigitalState) ||
    industry.limitations.some((item) => isSpecificIndustryLimitation(item)),
  );

  return {
    ...parsed,
    industryBreakdown,
    hypotheses: Array.from(new Set(gaps)).slice(0, 8),
  };
}

function isSpecificIndustryLimitation(value: string): boolean {
  if (/дефицитн(?:ая|ой)\s+бюджетн(?:ая|ой)\s+рамк|запуск\s+новых\s+инициатив\s+ограничен/i.test(value)) {
    return false;
  }
  return value.trim().length > 12;
}

function cleanUnconfirmedText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text) return undefined;
  if (/требу[её]т уточнения|необходимо получить|необходимо запросить|отсутствует|не раскрыт|не указано|в (?:представленных )?источниках нет|нет (?:конкретных |прямых )?(?:данных|сведений|упоминаний)|не содержит данных|не содержит сведений|без детализации|только общие сведения/i.test(text)) {
    return undefined;
  }
  return text
    .replace(/\bERP\b/gi, "система планирования ресурсов")
    .replace(/\bSCADA\b/gi, "система диспетчерского управления")
    .replace(/\bIoT\b/gi, "промышленный интернет");
}
