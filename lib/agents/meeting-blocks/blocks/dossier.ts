import type { MeetingBlockDeps, DossierBlockOutput } from "../types";
import type { LprDossier, LprTile } from "@/lib/schemas/structured-output";
import {
  prepareBlockSources,
  callBlockLLM,
  parseBlockJson,
  hasUsefulText,
  normalizeHypotheses,
  normalizeSources,
  normalizeFactSource,
  coerceTier,
  buildContextPreamble,
  buildMinistryContext,
  isRecord,
  regionCoreTokens,
} from "./base";
import { DOSSIER_SYSTEM_PROMPT, volumeDirective } from "@/lib/prompts/meeting-blocks-contract";
import { fetchWikiFacts } from "@/lib/integrations/open-data-retrieval";
import { logBlockEvent } from "@/lib/agents/region-blocks/logger";

/** Ключевые слова биографии для вытяжки о персоне из Википедии. */
const PERSON_WIKI_KEYWORDS = ["родил", "назначен", "образовани", "карьер", "должност", "министр", "губернатор", "возглав", "заместител"];

/**
 * Опциональная справка о ЛПР из Википедии — только если извлечённый текст
 * действительно про ЭТУ персону в ЭТОМ регионе/ведомстве (гейт релевантности),
 * иначе однофамилец мог бы подмешать чужую биографию. Пустая строка — если нет.
 */
async function fetchPersonFacts(deps: MeetingBlockDeps): Promise<string> {
  const name = (deps.lprName || "").trim();
  if (name.split(/\s+/).filter(Boolean).length < 2) return ""; // нужно хотя бы Имя Фамилия
  try {
    const wiki = await fetchWikiFacts(name, PERSON_WIKI_KEYWORDS, 1600);
    if (!wiki) return "";
    const hay = wiki.snippet.toLowerCase();
    const regionTokens = regionCoreTokens(deps.region || "");
    const roleTokens = [deps.ministry, deps.lprRole, "министр", "губернатор", "цифров"]
      .filter(Boolean)
      .flatMap((t) => t!.toLowerCase().split(/\s+/))
      .filter((t) => t.length >= 4);
    const relevant =
      regionTokens.some((t) => hay.includes(t)) || roleTokens.some((t) => hay.includes(t));
    return relevant ? wiki.snippet : "";
  } catch {
    return "";
  }
}

export async function generateDossierBlock(
  deps: MeetingBlockDeps,
  searchQueries: string[],
): Promise<DossierBlockOutput> {
  let { webEvidence, sources } = await prepareBlockSources(deps, searchQueries, {
    kind: "dossier",
    limit: 4,
  });

  // Умный поиск по персоне: точечная справка о ЛПР (с гейтом релевантности).
  const personFacts = await fetchPersonFacts(deps);
  if (personFacts) {
    webEvidence = `Справочные факты о персоне (Википедия):\n${personFacts}\n\n${webEvidence}`;
  }

  let userMessage = buildUserMessage(deps, webEvidence);
  let raw = await callBlockLLM(DOSSIER_SYSTEM_PROMPT, userMessage, deps.agentInstructions, {
    sessionId: deps.session.id,
    runId: deps.runId,
    label: "dossier",
    maxTokens: 1300,
  });
  let parsed = parseBlockJson(raw) as { lprDossier?: unknown; sources?: unknown; hypotheses?: unknown };

  // Fallback: если нет подтверждённого known — ищем состав руководства/биографию.
  if (!hasKnown(parsed)) {
    await logBlockEvent({
      sessionId: deps.session.id,
      runId: deps.runId,
      scope: "meeting.block",
      message: "dossier_fallback_start",
      data: { reason: "no_known_fact" },
    });
    const year = new Date().getFullYear();
    const nameQuery = deps.lprName
      ? [
          `${deps.lprName} ${deps.lprRole || ""} ${deps.region} официальная биография`.trim(),
          `${deps.lprName} ${deps.region} заявления приоритеты ${year}`,
        ]
      : [];
    ({ webEvidence, sources } = await prepareBlockSources(
      deps,
      [
        ...nameQuery,
        `${deps.region} ${deps.ministry || "министерство цифрового развития"} руководитель министр официальный состав`,
        `${deps.region} ${deps.ministry || "министерство"} биография министр образование назначение`,
      ],
      { kind: "dossier", skipCache: true, limit: 4 },
    ));
    if (personFacts) webEvidence = `Справочные факты о персоне (Википедия):\n${personFacts}\n\n${webEvidence}`;
    userMessage = buildUserMessage(deps, webEvidence);
    raw = await callBlockLLM(DOSSIER_SYSTEM_PROMPT, userMessage, deps.agentInstructions, {
      sessionId: deps.session.id,
      runId: deps.runId,
      label: "dossier_fallback",
      maxTokens: 1300,
    });
    parsed = parseBlockJson(raw) as typeof parsed;
  }

  const dossier = normalizeDossier(parsed.lprDossier, deps);

  return {
    lprDossier: dossier,
    sources: normalizeSources(parsed.sources).concat(sources).slice(0, 8),
    hypotheses: normalizeHypotheses(parsed.hypotheses),
  };
}

function buildUserMessage(deps: MeetingBlockDeps, webEvidence: string): string {
  return [
    `Регион: ${deps.region}`,
    deps.ministry ? `Ведомство: ${deps.ministry}` : "",
    deps.lprName ? `ЛПР (из ввода): ${deps.lprName}${deps.lprRole ? `, ${deps.lprRole}` : ""}` : "ЛПР: ФИО не задано — ищи официальный состав руководства ведомства",
    `Тема встречи: ${deps.focusTopic}`,
    volumeDirective(deps.session.materialPlan?.volume),
    "",
    buildContextPreamble(deps),
    buildMinistryContext(deps),
    "",
    `Сырые открытые источники:\n${webEvidence}`,
    "",
    "Собери тонкое честное досье: known (только из источников, с source), motive (гипотеза), relationship (из CRM/карточки), ask (что спросить).",
    "Не выдумывай ФИО, цитаты и KPI. Если биографии нет — сформулируй известное о должности как hypothesis/ask.",
  ]
    .filter(Boolean)
    .join("\n");
}

function hasKnown(parsed: { lprDossier?: unknown }): boolean {
  const d = parsed.lprDossier;
  if (!isRecord(d)) return false;
  const known = d.known;
  return isRecord(known) && hasUsefulText(known.text);
}

function normalizeTile(value: unknown, defaultTier: LprTile["tier"]): LprTile | undefined {
  if (!isRecord(value) || !hasUsefulText(value.text)) return undefined;
  const source = normalizeFactSource(value.source);
  return {
    text: value.text.trim(),
    tier: coerceTier(value.tier, Boolean(source?.url), defaultTier),
    source,
  };
}

function normalizeDossier(value: unknown, deps: MeetingBlockDeps): LprDossier {
  const d = isRecord(value) ? value : {};
  const name = hasUsefulText(d.name) ? d.name.trim() : deps.lprName || undefined;
  const role = hasUsefulText(d.role) ? d.role.trim() : deps.lprRole || undefined;
  // relationship — это tier="crm": допускаем ТОЛЬКО когда MemPalace реально вернул
  // прошлый контекст. Иначе модель склонна выдумать «тёплое отношение / оценка N/5»,
  // а выдуманный CRM недопустим. Нет памяти — нет плитки relationship.
  const hasMemory = Boolean(deps.memoryContext && deps.memoryContext.trim().length > 0);
  return {
    name,
    role,
    known: normalizeTile(d.known, "fact"),
    motive: normalizeTile(d.motive, "hypothesis"),
    relationship: hasMemory ? normalizeTile(d.relationship, "crm") : undefined,
    ask: normalizeTile(d.ask, "ask"),
  };
}
