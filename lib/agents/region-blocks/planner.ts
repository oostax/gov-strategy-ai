import type { SessionProfile } from "@/lib/schemas/session";
import type { RegionProfile } from "@/lib/schemas/region";
import { callLLM } from "@/lib/agents/llm-client";
import { canonicalRegionName } from "@/lib/data/region-normalization";
import { selectRelevantPlaybooks } from "@/lib/agents/prompt-builder";
import { getStorage } from "@/lib/storage/local-json-storage";
import {
  BLOCK_LABELS,
  BLOCK_DEPENDENCIES,
  BLOCK_ORDER,
  CLASSIC_SECTION_KINDS,
  type BlockKind,
  type BlockPlan,
  type RegionBlocksPlan,
} from "./types";

const PLANNER_PROMPT = `Ты — планировщик регионального анализа. Твоя задача: определить ТИП региона, сфокусировать анализ и собрать план генерации с поисковыми запросами.

Сначала классифицируй регион (archetype) — один из:
- "промышленный" — опора на обрабатывающую промышленность/ВПК/металлургию
- "ресурсно-сырьевой" — нефть, газ, добыча, металлы
- "аграрный" — АПК, сельское хозяйство — ядро экономики
- "моногород" / "моноэкономика" — зависимость от одного предприятия/отрасли
- "дотационный" — высокая доля федеральных трансфертов, слабая собственная база
- "диверсифицированный" — сбалансированная экономика крупного региона
- "логистический/приграничный" — транзит, порты, границы
- "туристический" — туризм/рекреация значимы
Если не уверен — выбери ближайший, не выдумывай новых.

Затем сформулируй focusAngle — ОДНУ фразу: на чём реально держится стратегическая картина именно этого региона (без общих слов).

Затем задай sectionOrder — порядок «классических» блоков под этот тип региона, от самого важного к менее важному. Доступные ключи:
"budget", "industries", "priorities", "scenarios", "competition", "stakeholders".
Правила sectionOrder:
- ОБЯЗАТЕЛЬНО включи: budget, industries, priorities, scenarios (порядок между ними — на твоё усмотрение под тип региона).
- competition и stakeholders — включай ТОЛЬКО если они реально релевантны (competition — если есть внешние поставщики/подрядчики; stakeholders — если фигуры руководителей значимы для решения). Если нерелевантно — не включай, это нормально.
- Веди тем, что важнее для этого архетипа: дотационный → сначала budget; моногород/промышленный → сначала industries; и т.д.

Для КАЖДОГО блока из sectionOrder плюс "summary" составь 2-3 конкретных поисковых запроса на русском под тему блока и регион. Используй полное официальное название субъекта РФ.

Верни ТОЛЬКО JSON:
{
  "archetype": "промышленный",
  "focusAngle": "одна фраза про суть региона",
  "sectionOrder": ["industries", "budget", "scenarios", "priorities", "competition"],
  "blocks": [
    { "kind": "summary", "searchQueries": ["запрос 1", "запрос 2"] },
    { "kind": "industries", "searchQueries": ["запрос 1", "запрос 2"] }
  ]
}

Без пояснений, без разметки, только JSON.`;

export async function planRegionBlocks(
  session: SessionProfile,
  region: RegionProfile | null,
): Promise<RegionBlocksPlan> {
  const regionName = canonicalRegionName(region?.name || session.region);
  const focusTopic = session.focusTopic || "цифровизация госсектора";
  const knownStakeholders = (region?.stakeholders || [])
    .map((person) => [person.fullName, person.role, person.department].filter(Boolean).join(" "))
    .filter(Boolean)
    .slice(0, 6);

  let playbookQueries: Record<string, string[]> | undefined;
  try {
    const playbooks = await getStorage().listPlaybooks();
    const active = selectRelevantPlaybooks(session, playbooks);
    playbookQueries = active.find((p) => p.searchQueries)?.searchQueries as Record<string, string[]> | undefined;
  } catch { playbookQueries = undefined; }

  const raw = await callLLM({
    messages: [
      {
        role: "system",
        content: PLANNER_PROMPT,
      },
      {
        role: "user",
        content: [
          `Регион: ${regionName}`,
          `Тема: ${focusTopic}`,
          `Глубина: ${session.detailLevel || "medium"}`,
          knownStakeholders.length
            ? `Известные руководители из карточки региона: ${knownStakeholders.join("; ")}`
            : "",
          "",
          "Для каждого блока напиши 2-3 поисковых запроса на русском, которые найдут актуальные данные.",
          "Для блока бюджета: запросы вида 'бюджет {регион} 2025 доходы расходы млрд', 'закон о бюджете {регион}'",
          "Для блока отраслей: 'структура экономики {регион} ВРП отрасли', 'промышленность {регион}'",
          "Для блока сценариев: 'стратегия развития {регион} до 2030', 'сценарные условия {регион}'",
          "Для блока конкурентов: 'ИТ контракты регион поставщик', 'региональная информационная система поставщик'",
          "Для блока руководителей: сначала официальный состав правительства/администрации региона, затем новости по уже подтверждённым региональным должностным лицам",
        ].join("\n"),
      },
    ],
    temperature: 0.2,
    maxTokens: 2000,
    responseFormat: "json_object",
  });

  let parsed: {
    archetype?: string;
    focusAngle?: string;
    sectionOrder?: string[];
    blocks?: Array<{ kind: string; searchQueries: string[] }>;
  };
  try {
    const cleaned = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = {};
  }

  const isBlockKind = (value: string): value is BlockKind =>
    (BLOCK_ORDER as readonly string[]).includes(value);

  // Обязательные «классические» блоки — их требует гейт готовности сборки.
  const coreClassic: BlockKind[] = ["budget", "industries", "priorities", "scenarios"];

  // 1) Порядок классических блоков под архетип (competition/stakeholders — опционально).
  const requested = Array.isArray(parsed.sectionOrder)
    ? parsed.sectionOrder.filter(isBlockKind).filter((k) => CLASSIC_SECTION_KINDS.includes(k))
    : [];
  const seen = new Set<BlockKind>();
  const sectionOrder: BlockKind[] = [];
  for (const kind of requested) {
    if (!seen.has(kind)) { seen.add(kind); sectionOrder.push(kind); }
  }
  for (const kind of coreClassic) {
    if (!seen.has(kind)) { seen.add(kind); sectionOrder.push(kind); }
  }
  const finalOrder: BlockKind[] = sectionOrder.length ? sectionOrder : [...CLASSIC_SECTION_KINDS];

  // 2) Набор блоков для генерации: summary + выбранные классические.
  const genSet = new Set<BlockKind>(["summary", ...finalOrder]);

  // 3) Запросы планировщика по kind.
  const queryByKind = new Map<BlockKind, string[]>();
  if (Array.isArray(parsed.blocks)) {
    for (const b of parsed.blocks) {
      if (b && typeof b.kind === "string" && isBlockKind(b.kind) && Array.isArray(b.searchQueries)) {
        queryByKind.set(b.kind, b.searchQueries);
      }
    }
  }

  // Собираем только выбранные блоки, в порядке сборки (BLOCK_ORDER — для волн/зависимостей).
  const blocks: BlockPlan[] = BLOCK_ORDER.filter((kind) => genSet.has(kind)).map((kind) => ({
    kind,
    label: BLOCK_LABELS[kind],
    searchQueries: normalizeBlockQueries(kind, queryByKind.get(kind) ?? [], regionName, playbookQueries, knownStakeholders).slice(0, 5),
    dependsOn: BLOCK_DEPENDENCIES[kind] || [],
  }));

  const archetype = typeof parsed.archetype === "string" ? parsed.archetype.trim().slice(0, 60) : "";
  const focusAngle = typeof parsed.focusAngle === "string" ? parsed.focusAngle.trim().slice(0, 240) : "";

  return {
    sessionId: session.id,
    region: regionName,
    focusTopic,
    blocks,
    createdAt: new Date().toISOString(),
    archetype: archetype || undefined,
    focusAngle: focusAngle || undefined,
    sectionOrder: finalOrder,
  };
}

export function fallbackRegionBlocksPlan(
  session: SessionProfile,
  region: RegionProfile | null,
): RegionBlocksPlan {
  const regionName = canonicalRegionName(region?.name || session.region);
  const focusTopic = session.focusTopic || "анализ региона";
  return {
    sessionId: session.id,
    region: regionName,
    focusTopic,
    blocks: BLOCK_ORDER.map((kind) => ({
      kind,
      label: BLOCK_LABELS[kind],
      searchQueries: normalizeBlockQueries(kind, [], regionName).slice(0, 5),
      dependsOn: BLOCK_DEPENDENCIES[kind] || [],
    })),
    createdAt: new Date().toISOString(),
    sectionOrder: [...CLASSIC_SECTION_KINDS],
  };
}

function normalizeBlockQueries(
  kind: BlockPlan["kind"],
  queries: string[],
  regionName: string,
  playbookQueries?: Record<string, string[]>,
  knownStakeholders: string[] = [],
): string[] {
  const cleaned = queries
    .map((query) => query.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((query) => (query.toLowerCase().includes(regionName.toLowerCase()) ? query : `${regionName} ${query}`));

  const year = new Date().getFullYear();

  const required: Partial<Record<BlockPlan["kind"], string[]>> = {
    summary: [
      `${regionName} население ВРП федеральный округ`,
      `${regionName} социально-экономическое положение`,
    ],
    budget: [
      `${regionName} закон о бюджете ${year} доходы расходы`,
      `${regionName} бюджет для граждан ${year} ${year + 1} ${year + 2}`,
      `${regionName} структура расходов бюджета образование здравоохранение национальная экономика`,
    ],
    industries: [
      `${regionName} структура экономики ВРП отрасли`,
      `${regionName} промышленность сельское хозяйство строительство торговля статистика`,
    ],
    priorities: [
      `${regionName} стратегия социально-экономического развития до 2030`,
      `${regionName} приоритеты развития на 5 лет губернатор`,
    ],
    scenarios: [
      `${regionName} стратегия социально-экономического развития до 2030`,
      `${regionName} приоритеты развития на 5 лет губернатор`,
    ],
    competition: [
      `${regionName} ИТ контракт поставщик информационная система закупки`,
      `${regionName} региональная информационная система поставщик внедрение`,
      `${regionName} цифровой проект подрядчик контракт министерство`,
    ],
    stakeholders: [
      ...knownStakeholders.flatMap((person) => [
        `${regionName} ${person} официальный сайт`,
        `${regionName} ${person} последние новости`,
      ]),
      `${regionName} официальный состав правительства заместители губернатора министры`,
      `${regionName} администрация официальный сайт руководство`,
      `${regionName} министерство финансов министерство экономики министр официальный`,
    ],
  };

  const playbookRequired = playbookQueries?.[kind]
    ?.map((q) => q.includes(regionName) ? q : `${regionName} ${q}`)
    ?? [];

  const requiredForKind = playbookRequired.length ? playbookRequired : required[kind] || [];

  const ordered = kind === "stakeholders"
    ? [...requiredForKind, ...cleaned]
    : [...cleaned, ...requiredForKind];
  return Array.from(new Set(ordered));
}

export function planToBlockStates(plan: RegionBlocksPlan) {
  return plan.blocks.map((b) => ({
    kind: b.kind,
    status: "pending" as const,
  }));
}
