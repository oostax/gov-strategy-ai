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
  type BlockKind,
  type BlockPlan,
  type RegionBlocksPlan,
} from "./types";

const PLANNER_PROMPT = `Ты — планировщик регионального анализа. Твоя задача: составить план генерации и поисковые запросы для анализа региона.

Типы блоков (в порядке сборки):
1. "summary" — карточка региона (название, ФО полностью, население, бюджет) + ключевой тезис
2. "budget" — бюджетный ландшафт: доходы, расходы, статьи, госпрограммы с суммами
3. "industries" — 3-5 ключевых отраслей с конкретными предприятиями и подтверждёнными ограничениями
4. "priorities" — стратегические приоритеты из стратегии СЭР, нацпроектов, указов губернатора
5. "scenarios" — 3-4 сценария развития региона на 5 лет с триггерами
6. "competition" — поставщики и конкурирующие решения в регионе с конкретными доказательствами (контракты, проекты)
7. "stakeholders" — руководители региона: губернатор, заместители губернатора, региональные министры с подтверждением должности

Для КАЖДОГО блока составь 2-3 поисковых запроса на русском языке,
максимально конкретные под тему блока и регион.
Используй site: для региональных доменов.
Во всех запросах используй полное официальное название субъекта Российской Федерации.

Верни ТОЛЬКО JSON:
{
  "blocks": [
    {
      "kind": "summary",
      "searchQueries": ["запрос 1", "запрос 2", "запрос 3"]
    }
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

  let parsed: { blocks?: Array<{ kind: string; searchQueries: string[] }> };
  try {
    const cleaned = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = { blocks: [] };
  }

  if (!parsed.blocks || !Array.isArray(parsed.blocks)) {
    parsed.blocks = BLOCK_ORDER.map((kind) => ({
      kind,
      searchQueries: [],
    }));
  }

  const isBlockKind = (value: string): value is BlockKind =>
    (BLOCK_ORDER as readonly string[]).includes(value);

  const blocks: BlockPlan[] = parsed.blocks
    .filter((b): b is { kind: string; searchQueries: string[] } =>
      isBlockKind(b.kind),
    )
    .map((b) => {
      const kind = b.kind as BlockPlan["kind"];
      return {
        kind,
        label: BLOCK_LABELS[kind] || b.kind,
        searchQueries: normalizeBlockQueries(kind, b.searchQueries, regionName, playbookQueries, knownStakeholders).slice(0, 5),
        dependsOn: BLOCK_DEPENDENCIES[kind] || [],
      };
    });

  if (!blocks.length) {
    blocks.push(
      ...BLOCK_ORDER.map((kind) => ({
        kind,
        label: BLOCK_LABELS[kind],
        searchQueries: [`${regionName} ${focusTopic} ${kind}`],
        dependsOn: BLOCK_DEPENDENCIES[kind] || [],
      })),
    );
  }

  const planned = new Set(blocks.map((block) => block.kind));
  for (const kind of BLOCK_ORDER) {
    if (planned.has(kind)) continue;
    blocks.push({
      kind,
      label: BLOCK_LABELS[kind],
      searchQueries: normalizeBlockQueries(kind, [], regionName, playbookQueries, knownStakeholders).slice(0, 5),
      dependsOn: BLOCK_DEPENDENCIES[kind] || [],
    });
  }

  return {
    sessionId: session.id,
    region: regionName,
    focusTopic,
    blocks: BLOCK_ORDER.map((kind) => blocks.find((block) => block.kind === kind)!).filter(Boolean),
    createdAt: new Date().toISOString(),
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
