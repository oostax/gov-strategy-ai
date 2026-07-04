import type { StakeholdersBlockOutput } from "../types";
import type { BlockDeps } from "../types";
import type { RegionStakeholder } from "@/lib/schemas/structured-output";
import { prepareBlockSources, callBlockLLM, parseBlockJson, refineByAgentInstructions, normalizeHypotheses, buildContextPreamble, pickString } from "./base";

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

  const contextBlock = [
    `Регион: ${deps.region}`,
    `Тема: ${deps.focusTopic}`,
    "",
    buildContextPreamble(deps),
    "",
    `Источники:\n${webEvidence}`,
  ].join("\n");

  const userMessage = [
    contextBlock,
    "",
    "Составь карту региональных руководителей: губернатор, заместители губернатора, ключевые министры субъекта.",
    "Не включай федеральных чиновников и гостей региона; новость о визите не делает человека региональным ЛПР.",
    "Для каждого укажи конкретные достижения и последние новости.",
    "Только реальные люди, подтверждённые источниками.",
  ].join("\n");

  const raw = await callBlockLLM(SYSTEM_PROMPT, userMessage, deps.agentInstructions, { sessionId: deps.session.id, runId: deps.runId, label: "stakeholders" });
  let parsed = parseBlockJson(raw) as { stakeholderMap?: unknown; sources?: unknown; hypotheses?: unknown };

  parsed = await refineByAgentInstructions(parsed, "Руководители и ведомства", SYSTEM_PROMPT, userMessage, deps.agentInstructions);

  let stakeholderMap = normalizeStakeholders(parsed.stakeholderMap);
  // Salvage: reasoning-модель нередко роняет массив stakeholderMap при наличии
  // источников — добираем его отдельным узким вызовом (только массив).
  if (stakeholderMap.length === 0) {
    stakeholderMap = await salvageStakeholders(deps, contextBlock);
  }

  return {
    stakeholderMap: stakeholderMap.slice(0, 6),
    sources: [...(Array.isArray(parsed.sources) ? (parsed.sources as StakeholdersBlockOutput["sources"]) : []), ...sources],
    hypotheses: normalizeHypotheses(parsed.hypotheses),
  };
}

/** Толерантная нормализация: синонимы ключей + региональный фильтр. */
function normalizeStakeholders(value: unknown): RegionStakeholder[] {
  if (!Array.isArray(value)) return [];
  const out: RegionStakeholder[] = [];
  for (const item of value) {
    const name = pickString(item, ["name", "fullName", "fio", "ФИО", "person"]);
    const role = pickString(item, ["role", "position", "title", "post", "должность"]);
    if (!name || !role) continue;
    const stk: RegionStakeholder = {
      id: pickString(item, ["id"]) || `stk_${out.length + 1}`,
      name,
      role,
      department: pickString(item, ["department", "dept", "agency", "ministry", "body", "org", "ведомство"]),
      achievements: pickString(item, ["achievements", "achievement", "results", "track"]),
      recentNews: pickString(item, ["recentNews", "news", "recent", "latest"]),
      managedBudget: pickString(item, ["managedBudget", "budget", "resources"]) || undefined,
      managementInterest: pickString(item, ["managementInterest", "interest", "kpi", "responsibility"]),
      relationshipToSber: pickString(item, ["relationshipToSber", "sber", "sberRelationship"]),
      engagementPrinciple: pickString(item, ["engagementPrinciple", "engagement", "approach", "howToEngage"]),
    };
    if (!isRegionalStakeholder(stk)) continue;
    out.push(stk);
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * Узкий повторный вызов: просим ТОЛЬКО массив stakeholderMap с примером и
 * обязательными name/role. Опора на контекст/источники — без выдумки.
 */
async function salvageStakeholders(deps: BlockDeps, contextBlock: string): Promise<RegionStakeholder[]> {
  const salvageMessage = [
    contextBlock,
    "",
    'Верни ТОЛЬКО JSON вида {"stakeholderMap":[ ... ]} — БЕЗ каких-либо других полей.',
    "4-6 реальных региональных ЛПР субъекта: губернатор; вице-губернаторы / заместители председателя правительства; министр цифрового развития; министр финансов; министр экономики; профильные министры.",
    "У КАЖДОГО объекта ОБЯЗАТЕЛЬНЫ непустые name (ФИО) и role (должность). Только публичные должностные лица субъекта, без федеральных. Не выдумывай ФИО — опирайся на источники и контекст.",
    'Пример: {"id":"stk_1","name":"Фамилия Имя Отчество","role":"Губернатор","department":"Администрация региона","achievements":"...","recentNews":"...","managementInterest":"...","relationshipToSber":"","engagementPrinciple":"..."}',
  ].join("\n");
  try {
    const raw = await callBlockLLM(SYSTEM_PROMPT, salvageMessage, deps.agentInstructions, {
      sessionId: deps.session.id,
      runId: deps.runId,
      label: "stakeholders.salvage",
    });
    const parsed = parseBlockJson(raw) as { stakeholderMap?: unknown };
    return normalizeStakeholders(parsed.stakeholderMap);
  } catch {
    return [];
  }
}

/**
 * Региональный уровень: отсекаем явный федеральный, принимаем губернатора,
 * вице-губернаторов, членов правительства субъекта и министров (в т.ч. роль
 * «Министр …» без слова «министерство»).
 */
function isRegionalStakeholder(item: RegionStakeholder) {
  const roleDept = `${item.role} ${item.department}`.toLowerCase();
  if (/\bрф\b|российской федерации|федеральн|госдум|совет федерации|сенатор|государственной думы|правительств[ао]\s+рф|министр[а-я]*\s+рф/i.test(roleDept)) {
    return false;
  }
  return /губернатор|администрац|правительств|министр|министерств|комитет|департамент|управлени|глав[аы]|председател|замести/i.test(roleDept);
}
