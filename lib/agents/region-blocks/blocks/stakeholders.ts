import type { StakeholdersBlockOutput } from "../types";
import type { BlockDeps } from "../types";
import type { RegionStakeholder } from "@/lib/schemas/structured-output";
import { prepareBlockSources, callBlockLLM, parseBlockJson, refineByAgentInstructions, normalizeHypotheses, buildContextPreamble, pickString } from "./base";
import { fetchWikiFacts } from "@/lib/integrations/open-data-retrieval";

/** Ключевые слова для вытяжки руководства региона из статьи Википедии. */
const OFFICIALS_WIKI_KEYWORDS = [
  "Губернатор",
  "Глава администрации",
  "Глава Республики",
  "Председатель Правительства",
  "председатель правительства",
  "вице-губернатор",
  "мэр",
];

const SYSTEM_PROMPT = `Ты — аналитик по региональным ЛПР. Составь карту ключевых лиц, принимающих решения в регионе.

Правила:
- 4-6 конкретных человек: губернатор, зампреды, министры (цифрового развития, финансов, экономики), отраслевые министры.
- Только региональные публичные должностные лица, подтверждённые официальным источником региона: губернатор, заместители губернатора, члены правительства региона, региональные министры.
- Не включай федеральных министров, вице-премьеров, депутатов Госдумы, сенаторов, федеральных гостей и руководителей федеральных ведомств, даже если они упомянуты в новости о регионе.
- Сначала подтверди должность в правительстве/администрации региона, только потом используй новости за последний год.
- name: имя ТОЧНО как в источнике. НЕ угадывай и НЕ добавляй отчество, если его нет в тексте источника — лучше «Имя Фамилия» (напр. «Вениамин Кондратьев»), чем выдуманное отчество. Неверное отчество недопустимо.
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

  // Губернатор и ключевые руководители надёжно есть в статье Википедии региона
  // (инфобокс/вступление). Тянем это отдельно, чтобы состав руководства не
  // «плавал» между прогонами (иначе reasoning-модель то называет губернатора,
  // то возвращает пусто). Живой источник, не мок.
  const wikiOfficials = await fetchWikiFacts(deps.region, OFFICIALS_WIKI_KEYWORDS, 2200);
  const officialsFacts = wikiOfficials
    ? `Справочные факты о руководстве региона (из статьи Википедии):\n${wikiOfficials.snippet}\n\n`
    : "";

  const contextBlock = [
    `Регион: ${deps.region}`,
    `Тема: ${deps.focusTopic}`,
    "",
    officialsFacts,
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
  // Детерминированный «пол»: если модель всё равно вернула пусто, извлекаем
  // руководителей регексом прямо из wiki-вытяжки (office-слово + следующее ФИО).
  // Гарантирует, что губернатор не «плавает» между прогонами. ФИО строго из
  // текста — без выдуманных отчеств.
  if (stakeholderMap.length === 0 && wikiOfficials) {
    stakeholderMap = extractLeadersFromText(wikiOfficials.snippet);
  }

  const wikiSource = wikiOfficials
    ? [{ title: wikiOfficials.title, url: wikiOfficials.url, excerpt: wikiOfficials.snippet.slice(0, 220), isVerified: true }]
    : [];

  return {
    stakeholderMap: stakeholderMap.slice(0, 6),
    sources: [
      ...(Array.isArray(parsed.sources) ? (parsed.sources as StakeholdersBlockOutput["sources"]) : []),
      ...wikiSource,
      ...sources,
    ],
    hypotheses: normalizeHypotheses(parsed.hypotheses),
  };
}

/**
 * Детерминированное извлечение руководителей из справочного текста: находим
 * office-слово (губернатор/глава/председатель правительства/мэр) и берём
 * следующее за ним ФИО (2-3 слова с заглавной). ФИО строго из текста — без
 * выдуманных отчеств. Регион-агностично, без хардкода.
 */
function extractLeadersFromText(text: string): RegionStakeholder[] {
  const offices: Array<{ rx: RegExp; role: string }> = [
    { rx: /губернатор[а-я]*/i, role: "Губернатор" },
    { rx: /глав[аеы]\s+республики/i, role: "Глава Республики" },
    { rx: /глав[аеы]\s+администрации/i, role: "Глава администрации" },
    { rx: /председател[ья]\s+правительства/i, role: "Председатель Правительства" },
    { rx: /мэр[а-я]*/i, role: "Мэр" },
  ];
  const nameRx = /([А-ЯЁ][а-яё]+)\s+([А-ЯЁ][а-яё]+)(?:\s+([А-ЯЁ][а-яё]+))?/;
  const out: RegionStakeholder[] = [];
  const seen = new Set<string>();
  const skip = new Set(["Региона", "Области", "Края", "Республики", "Округа", "Города"]);
  for (const office of offices) {
    const m = office.rx.exec(text);
    if (!m) continue;
    // Ищем ФИО в пределах ~40 символов после office-слова.
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 60);
    const nm = nameRx.exec(after);
    if (!nm) continue;
    // Пропускаем ложные срабатывания вида «губернатор Области ...».
    const parts = [nm[1], nm[2], nm[3]].filter((p): p is string => Boolean(p) && !skip.has(p));
    if (parts.length < 2) continue;
    const name = parts.join(" ");
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({
      id: `stk_${out.length + 1}`,
      name,
      role: office.role,
      department: "",
      achievements: "",
      recentNews: "",
      managementInterest: "",
      relationshipToSber: "",
      engagementPrinciple: "",
    });
    if (out.length >= 4) break;
  }
  return out;
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
    "У КАЖДОГО объекта ОБЯЗАТЕЛЬНЫ непустые name и role. Имя — ТОЧНО как в источнике; НЕ добавляй отчество, если его нет в тексте (лучше «Имя Фамилия», чем выдуманное отчество). Только публичные должностные лица субъекта, без федеральных.",
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
