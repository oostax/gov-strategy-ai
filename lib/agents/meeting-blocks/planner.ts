import type { SessionProfile } from "@/lib/schemas/session";
import type { RegionProfile } from "@/lib/schemas/region";
import { callLLM } from "@/lib/agents/llm-client";
import { canonicalRegionName } from "@/lib/data/region-normalization";
import { getStorage } from "@/lib/storage/local-json-storage";
import { selectRelevantPlaybooks } from "@/lib/agents/prompt-builder";
import { blocksForTask } from "@/lib/schemas/material-plan";
import {
  MEETING_BLOCK_DEPENDENCIES,
  MEETING_BLOCK_LABELS,
  MEETING_BLOCK_ORDER,
  type MeetingBlockKind,
  type MeetingBlockPlan,
  type MeetingBlocksPlan,
} from "./types";

const PLANNER_PROMPT = `Ты — планировщик подготовки встречи руководителя госсектора Сбера с ЛПР региона. Определи ТИП встречи, сфокусируй её и собери план генерации с поисковыми запросами по блокам.

Сначала классифицируй встречу (archetype) — один из:
- "бюджетная защита" — ключевой барьер в деньгах (дефицит, нет строки бюджета)
- "техвнедрение" — вопрос интеграции/замены существующих систем, важен техпривратник и подрядчики
- "политический альянс" — важнее статус, кураторы, экосистема региона
- "продажа пилота" — заходим с конкретным пилотом/оффером
- "стратегический диалог" — обзорная встреча, повестка широкая
Если не уверен — выбери ближайший, не выдумывай новых.

Затем focusAngle — ОДНУ фразу: на чём реально держится эта встреча (без общих слов).

Затем sectionOrder — порядок блоков под этот тип встречи, от важного к второстепенному. Доступные ключи:
"ministry", "dossier", "participants", "theses", "objections", "sber", "agenda", "after".
Правила: ministry всегда первым (ядро). "бюджетная защита" → усиль ministry(бюджет) и objections; "техвнедрение" → подними participants и incumbents (в ministry).

Для КАЖДОГО блока из sectionOrder составь 2-3 конкретных поисковых запроса на русском под тему блока, регион и ведомство/ЛПР. Используй полное официальное название субъекта РФ и точные ФИО/названия в кавычках, если известны.

Верни ТОЛЬКО JSON:
{
  "archetype": "бюджетная защита",
  "focusAngle": "одна фраза",
  "sectionOrder": ["ministry","dossier","theses","objections","sber","agenda","after"],
  "blocks": [
    { "kind": "ministry", "searchQueries": ["запрос 1", "запрос 2"] },
    { "kind": "dossier", "searchQueries": ["запрос 1"] }
  ]
}

Без пояснений, без разметки, только JSON.`;

/**
 * Ведомство и ЛПР выводятся из полей встречи: meetingWith (кто), focusTopic и
 * region. Явного поля «ведомство» в сессии нет, поэтому ministry берём из
 * meetingWith/focusTopic эвристически (для запросов), не выдумывая точное имя.
 */
function deriveMeetingSubject(session: SessionProfile): {
  ministry: string;
  lprName: string;
  lprRole: string;
} {
  const meetingWith = (session.meetingWith || "").trim();
  // meetingWith часто вида «Илья Начвин, министр цифрового развития РТ» или
  // «Минцифры РТ» — разбираем на ФИО (первые слова с заглавной) и роль/ведомство.
  let lprName = "";
  let lprRole = "";
  if (meetingWith) {
    const parts = meetingWith.split(/[,—-]/).map((p) => p.trim()).filter(Boolean);
    const looksLikeName = (s: string) =>
      /^[А-ЯЁ][а-яё]+(\s+[А-ЯЁ][а-яё]+){1,2}$/.test(s.trim());
    if (parts.length && looksLikeName(parts[0])) {
      lprName = parts[0];
      lprRole = parts.slice(1).join(", ");
    } else {
      lprRole = meetingWith;
    }
  }
  // Ведомство: из роли ЛПР, если она похожа на орган; иначе из focusTopic.
  const ministrySource = lprRole || meetingWith || session.focusTopic || "";
  const ministryMatch = ministrySource.match(
    /(министерств[а-я]*|минцифр[а-я]*|комитет[а-я]*|департамент[а-я]*|управлени[а-я]*|администраци[а-я]*|правительств[а-я]*)[^,;.]*/i,
  );
  const ministry = ministryMatch ? ministryMatch[0].trim() : "";
  return { ministry, lprName, lprRole };
}

/**
 * Состав/порядок блоков из «Плана материала» руководителя, если он задан.
 * id реестра meeting_preparation совпадают с MeetingBlockKind (кроме sources —
 * это виртуальный блок ассемблера). ministry — ядро, добавляется всегда.
 * Возвращает undefined, если плана нет.
 */
function planFromMaterialPlan(session: SessionProfile): MeetingBlockKind[] | undefined {
  const blocks = session.materialPlan?.blocks;
  if (!Array.isArray(blocks) || blocks.length === 0) return undefined;
  const isKind = (v: string): v is MeetingBlockKind =>
    (MEETING_BLOCK_ORDER as readonly string[]).includes(v);
  const ordered: MeetingBlockKind[] = [];
  const seen = new Set<MeetingBlockKind>();
  for (const id of blocks) {
    if (isKind(id) && !seen.has(id)) {
      seen.add(id);
      ordered.push(id);
    }
  }
  // ministry — ядро (гейт + зависимость theses); в голову, если не выбран.
  if (!seen.has("ministry")) {
    ordered.unshift("ministry");
    seen.add("ministry");
  }
  return ordered;
}

/**
 * Разворачивает скрытые зависимости: если выбраны блоки, чьи dependsOn не в
 * наборе, добавляем недостающие как hidden (генерируются, но не в sectionOrder).
 * Возвращает полный набор для генерации + флаг hidden по kind.
 */
function expandDependencies(visible: MeetingBlockKind[]): {
  genKinds: MeetingBlockKind[];
  hidden: Set<MeetingBlockKind>;
} {
  const needed = new Set<MeetingBlockKind>(visible);
  const hidden = new Set<MeetingBlockKind>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const kind of Array.from(needed)) {
      for (const dep of MEETING_BLOCK_DEPENDENCIES[kind] || []) {
        if (!needed.has(dep)) {
          needed.add(dep);
          if (!visible.includes(dep)) hidden.add(dep);
          changed = true;
        }
      }
    }
  }
  // Порядок сборки — по MEETING_BLOCK_ORDER (для волн/зависимостей).
  const genKinds = MEETING_BLOCK_ORDER.filter((k) => needed.has(k));
  return { genKinds, hidden };
}

export async function planMeetingBlocks(
  session: SessionProfile,
  region: RegionProfile | null,
): Promise<MeetingBlocksPlan> {
  const regionName = canonicalRegionName(region?.name || session.region || "");
  const focusTopic = session.focusTopic || session.meetingGoal || "цифровизация госсектора";
  const { ministry, lprName, lprRole } = deriveMeetingSubject(session);

  let playbookQueries: Record<string, string[]> | undefined;
  try {
    const playbooks = await getStorage().listPlaybooks();
    const active = selectRelevantPlaybooks(session, playbooks);
    playbookQueries = active.find((p) => p.searchQueries)?.searchQueries as
      | Record<string, string[]>
      | undefined;
  } catch {
    playbookQueries = undefined;
  }

  let parsed: {
    archetype?: string;
    focusAngle?: string;
    sectionOrder?: string[];
    blocks?: Array<{ kind: string; searchQueries: string[] }>;
  } = {};
  try {
    const raw = await callLLM({
      messages: [
        { role: "system", content: PLANNER_PROMPT },
        {
          role: "user",
          content: [
            `Регион: ${regionName || "не указан"}`,
            ministry ? `Ведомство: ${ministry}` : "Ведомство: вывести из темы/ЛПР",
            lprName ? `ЛПР: ${lprName}${lprRole ? `, ${lprRole}` : ""}` : session.meetingWith ? `С кем встреча: ${session.meetingWith}` : "",
            `Тема встречи: ${focusTopic}`,
            session.meetingGoal ? `Цель встречи: ${session.meetingGoal}` : "",
            session.meetingContext ? `Контекст: ${session.meetingContext}` : "",
            `Объём: ${session.materialPlan?.volume || session.detailLevel || "medium"}`,
            "",
            "Составь по 2-3 поисковых запроса на блок. Для ministry — бюджет региона, ИТ-расходы, обращения, инициативы. Для dossier — ФИО и должность (в кавычках). Для objections — дефицит бюджета, импортозамещение.",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      temperature: 0.2,
      maxTokens: 1800,
      responseFormat: "json_object",
    });
    const cleaned = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = {};
  }

  const isKind = (value: string): value is MeetingBlockKind =>
    (MEETING_BLOCK_ORDER as readonly string[]).includes(value);

  // 1) Видимый порядок: приоритет — план материала руководителя; иначе LLM; иначе дефолт.
  const planOrder = planFromMaterialPlan(session);
  const llmOrder = Array.isArray(parsed.sectionOrder)
    ? dedupe(parsed.sectionOrder.filter(isKind))
    : [];
  const visibleOrder: MeetingBlockKind[] =
    planOrder ?? (llmOrder.length ? ensureMinistryFirst(llmOrder) : defaultVisibleOrder(session));

  // 2) Разворачиваем скрытые зависимости (theses для objections/sber и т.п.).
  const { genKinds, hidden } = expandDependencies(visibleOrder);

  // 3) Запросы планировщика по kind.
  const queryByKind = new Map<MeetingBlockKind, string[]>();
  if (Array.isArray(parsed.blocks)) {
    for (const b of parsed.blocks) {
      if (b && typeof b.kind === "string" && isKind(b.kind) && Array.isArray(b.searchQueries)) {
        queryByKind.set(b.kind, b.searchQueries);
      }
    }
  }

  const ctx = { regionName, ministry, lprName, lprRole, focusTopic };
  const blocks: MeetingBlockPlan[] = genKinds.map((kind) => ({
    kind,
    label: MEETING_BLOCK_LABELS[kind],
    searchQueries: normalizeBlockQueries(kind, queryByKind.get(kind) ?? [], ctx, playbookQueries).slice(0, 5),
    dependsOn: MEETING_BLOCK_DEPENDENCIES[kind] || [],
    hidden: hidden.has(kind) ? true : undefined,
  }));

  const archetype = typeof parsed.archetype === "string" ? parsed.archetype.trim().slice(0, 60) : "";
  const focusAngle = typeof parsed.focusAngle === "string" ? parsed.focusAngle.trim().slice(0, 240) : "";

  return {
    sessionId: session.id,
    region: regionName,
    ministry,
    lprName,
    lprRole,
    focusTopic,
    blocks,
    createdAt: new Date().toISOString(),
    archetype: archetype || undefined,
    focusAngle: focusAngle || undefined,
    // sectionOrder для дашборда — только видимые блоки + sources в хвост.
    sectionOrder: [...visibleOrder, "sources"],
  };
}

export function fallbackMeetingBlocksPlan(
  session: SessionProfile,
  region: RegionProfile | null,
): MeetingBlocksPlan {
  const regionName = canonicalRegionName(region?.name || session.region || "");
  const focusTopic = session.focusTopic || session.meetingGoal || "подготовка встречи";
  const { ministry, lprName, lprRole } = deriveMeetingSubject(session);
  const planOrder = planFromMaterialPlan(session);
  const visibleOrder = planOrder ?? defaultVisibleOrder(session);
  const { genKinds, hidden } = expandDependencies(visibleOrder);
  const ctx = { regionName, ministry, lprName, lprRole, focusTopic };
  return {
    sessionId: session.id,
    region: regionName,
    ministry,
    lprName,
    lprRole,
    focusTopic,
    blocks: genKinds.map((kind) => ({
      kind,
      label: MEETING_BLOCK_LABELS[kind],
      searchQueries: normalizeBlockQueries(kind, [], ctx).slice(0, 5),
      dependsOn: MEETING_BLOCK_DEPENDENCIES[kind] || [],
      hidden: hidden.has(kind) ? true : undefined,
    })),
    createdAt: new Date().toISOString(),
    sectionOrder: [...visibleOrder, "sources"],
  };
}

// ── helpers ─────────────────────────────────────────────────────────────────

function dedupe(list: MeetingBlockKind[]): MeetingBlockKind[] {
  const seen = new Set<MeetingBlockKind>();
  const out: MeetingBlockKind[] = [];
  for (const k of list) {
    if (!seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

function ensureMinistryFirst(order: MeetingBlockKind[]): MeetingBlockKind[] {
  const withoutMinistry = order.filter((k) => k !== "ministry");
  return ["ministry", ...withoutMinistry];
}

/** Дефолтный видимый состав из реестра material-plan (порядок дашборда). */
function defaultVisibleOrder(session: SessionProfile): MeetingBlockKind[] {
  const registry = blocksForTask(session.taskType)
    .map((b) => b.id)
    .filter((id): id is MeetingBlockKind => (MEETING_BLOCK_ORDER as readonly string[]).includes(id));
  const order = registry.length ? registry : [...MEETING_BLOCK_ORDER];
  return ensureMinistryFirst(dedupe(order));
}

function normalizeBlockQueries(
  kind: MeetingBlockKind,
  queries: string[],
  ctx: { regionName: string; ministry: string; lprName: string; lprRole: string; focusTopic: string },
  playbookQueries?: Record<string, string[]>,
): string[] {
  const { regionName, ministry, lprName, focusTopic } = ctx;
  const year = new Date().getFullYear();
  const ministryTerm = ministry || `${regionName} цифровое развитие`;

  const cleaned = queries
    .map((query) => query.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((query) =>
      regionName && !query.toLowerCase().includes(regionName.toLowerCase()) ? `${regionName} ${query}` : query,
    );

  const required: Record<MeetingBlockKind, string[]> = {
    ministry: [
      `${ministryTerm} ${regionName} бюджет ${year} расходы информатизация ИТ`,
      `${regionName} бюджет ${year} доходы расходы дефицит официальный`,
      `${ministryTerm} ${regionName} обращения граждан платформа обратной связи объём`,
      `${ministryTerm} ${regionName} информационная система внедрение подрядчик контракт`,
    ],
    dossier: lprName
      ? [
          `${lprName} ${ctx.lprRole || ""} ${regionName} официальная биография`.trim(),
          `${lprName} ${regionName} последние заявления приоритеты ${year}`,
        ]
      : [`${regionName} ${ministryTerm} руководитель министр официальный состав`],
    participants: [
      `${regionName} ${ministryTerm} заместители руководство официальный сайт`,
      `${regionName} министерство финансов куратор ИТ цифровизация`,
    ],
    theses: [`${regionName} ${focusTopic} эффект кейс региона`],
    objections: [
      `${regionName} бюджет дефицит ${year}`,
      `${regionName} импортозамещение отечественное ПО реестр`,
    ],
    sber: [
      `Сбер ${focusTopic} госсектор кейс регион`,
      `СберБизнес GigaChat ${focusTopic} внедрение`,
    ],
    // agenda/after обычно без поиска — синтез из priorBlocks.
    agenda: [],
    after: [],
  };

  const playbookRequired =
    playbookQueries?.[kind]?.map((q) =>
      regionName && !q.includes(regionName) ? `${regionName} ${q}` : q,
    ) ?? [];

  const requiredForKind = playbookRequired.length ? playbookRequired : required[kind] || [];
  // Для dossier именные запросы вперёд (точность), для остальных — LLM вперёд.
  const ordered =
    kind === "dossier" ? [...requiredForKind, ...cleaned] : [...cleaned, ...requiredForKind];
  return Array.from(new Set(ordered.filter(Boolean)));
}
