import type { StakeholdersBlockOutput } from "../types";
import type { BlockDeps } from "../types";
import { prepareBlockSources, callBlockLLM, parseBlockJson, refineByAgentInstructions, normalizeHypotheses, buildContextPreamble } from "./base";

const SYSTEM_PROMPT = `Ты — аналитик по региональным ЛПР. Составь карту ключевых лиц, принимающих решения в регионе.

Правила:
- 4-6 конкретных человек: губернатор, зампреды, министры (цифрового развития, финансов, экономики), отраслевые министры.
- Только региональные публичные должностные лица, подтверждённые официальным источником региона: губернатор, заместители губернатора, члены правительства региона, региональные министры.
- Не включай федеральных министров, вице-премьеров, депутатов Госдумы, сенаторов, федеральных гостей и руководителей федеральных ведомств, даже если они упомянуты в новости о регионе.
- Сначала подтверди должность в правительстве/администрации региона, только потом используй новости за последний год.
- name: ФИО полностью.
- role: должность.
- department: ведомство.
- achievements: конкретные достижения, инициативы, результаты (с годами).
- recentNews: последние публичные события, выступления, решения (за последний год).
- managedBudget: какой бюджет/ресурс курирует (если известно из источников).
- managementInterest: управленческий интерес, KPI, зона ответственности.
- relationshipToSber: только публично подтверждённые контакты со Сбером или совместные проекты; если источника нет, оставь пустым.
- engagementPrinciple: управленческий подход без слов "заход", "боль", "мотив", "продажа".
- Не выдумывай ФИО. Если не знаешь — не включай.
- Если подтверждённых людей меньше четырёх, верни столько, сколько подтверждено; не создавай должности без ФИО.
- Верни ТОЛЬКО JSON.

Схема:
{
  "stakeholderMap": [
    {
      "id":"stk_1",
      "name":"ФИО",
      "role":"должность",
      "department":"ведомство",
      "achievements":"конкретные достижения с годами",
      "recentNews":"последние события",
      "managedBudget":"курируемый бюджет",
      "managementInterest":"KPI и зона ответственности",
      "relationshipToSber":"контакты со Сбером",
      "engagementPrinciple":"как взаимодействовать"
    }
  ],
  "sources": [],
  "hypotheses": []
}`;

export async function generateStakeholdersBlock(
  deps: BlockDeps,
  searchQueries: string[],
): Promise<StakeholdersBlockOutput> {
  const { webEvidence, sources } = await prepareBlockSources(
    deps,
    searchQueries,
    { kind: "stakeholders" },
  );

  const userMessage = [
    `Регион: ${deps.region}`,
    `Тема: ${deps.focusTopic}`,
    "",
    buildContextPreamble(deps),
    "",
    `Источники:\n${webEvidence}`,
    "",
    "Составь карту региональных руководителей: губернатор, заместители губернатора, ключевые министры субъекта.",
    "Не включай федеральных чиновников и гостей региона; новость о визите не делает человека региональным ЛПР.",
    "Для каждого укажи конкретные достижения и последние новости.",
    "Только реальные люди, подтверждённые источниками.",
  ].join("\n");

  const raw = await callBlockLLM(SYSTEM_PROMPT, userMessage, deps.agentInstructions, { sessionId: deps.session.id, runId: deps.runId, label: "stakeholders" });
  let parsed = parseBlockJson(raw) as StakeholdersBlockOutput;

  parsed = await refineByAgentInstructions(parsed, "Руководители и ведомства", SYSTEM_PROMPT, userMessage, deps.agentInstructions);

  return {
    stakeholderMap: (parsed.stakeholderMap || [])
      .filter((item) => item.name?.trim() && item.role?.trim())
      .filter(isRegionalStakeholder)
      .slice(0, 6),
    sources: [...(parsed.sources || []), ...sources],
    hypotheses: normalizeHypotheses(parsed.hypotheses),
  };
}

function isRegionalStakeholder(item: StakeholdersBlockOutput["stakeholderMap"][number]) {
  const roleDept = `${item.role} ${item.department}`.toLowerCase();
  if (/правительств[ао]\s+рф|российской федерации|федеральн(?:ый|ого|ая|ой)|госдум|совет федерации|сенатор|министр\s+рф|вице[-\s]?премьер/i.test(roleDept)) {
    return false;
  }
  return /губернатор|администрац|правительств|министерств|комитет|департамент|заместитель губернатора|заместитель председателя правительства/i.test(roleDept);
}
