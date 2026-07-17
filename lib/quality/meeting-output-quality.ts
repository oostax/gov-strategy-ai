export const REQUIRED_AGENDA_FIELDS = [
  "time",
  "topic",
  "sberSays",
  "askLpr",
  "fixDecision",
] as const;

export const REQUIRED_SBER_ACTION_FIELDS = [
  "asset",
  "firstTwoWeeks",
  "dataNeeded",
  "artifact",
  "commercialNextStep",
] as const;

export type QualityIssue = {
  code: string;
  message: string;
  path?: string;
};

export type CollectionQuality = {
  total: number;
  complete: number;
  missing: Array<{ index: number; fields: string[] }>;
  ready: boolean;
};

export type MeetingQualityReport = {
  ready: boolean;
  score: number;
  issues: QualityIssue[];
  agenda: CollectionQuality;
  sberActions: CollectionQuality;
};

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function missingAgendaFields(value: unknown): string[] {
  const item = asRecord(value);
  if (!item) return [...REQUIRED_AGENDA_FIELDS];
  return REQUIRED_AGENDA_FIELDS.filter((field) => !isNonEmptyString(item[field]));
}

export function isCompleteAgendaItem(value: unknown): boolean {
  return missingAgendaFields(value).length === 0;
}

export function assessAgenda(value: unknown, minimumItems = 4): CollectionQuality {
  const items = Array.isArray(value) ? value : [];
  const missing = items
    .map((item, index) => ({ index, fields: missingAgendaFields(item) }))
    .filter((item) => item.fields.length > 0);
  const complete = items.length - missing.length;
  return {
    total: items.length,
    complete,
    missing,
    ready: items.length >= minimumItems && complete === items.length,
  };
}

export function missingSberActionFields(value: unknown): string[] {
  const item = asRecord(value);
  if (!item) return [...REQUIRED_SBER_ACTION_FIELDS];
  return REQUIRED_SBER_ACTION_FIELDS.filter((field) => !isNonEmptyString(item[field]));
}

export function isCompleteSberAction(value: unknown): boolean {
  return missingSberActionFields(value).length === 0;
}

export function assessSberActions(value: unknown, minimumItems = 2): CollectionQuality {
  const items = Array.isArray(value) ? value : [];
  const missing = items
    .map((item, index) => ({ index, fields: missingSberActionFields(item) }))
    .filter((item) => item.fields.length > 0);
  const complete = items.length - missing.length;
  return {
    total: items.length,
    complete,
    missing,
    ready: items.length >= minimumItems && complete === items.length,
  };
}

function sectionIsRequired(
  section: string,
  taskType: string | undefined,
  sectionOrder: unknown,
): boolean {
  if (Array.isArray(sectionOrder)) return sectionOrder.includes(section);
  if (taskType === "meeting_preparation") return section === "agenda" || section === "sber";
  return false;
}

export function assessMeetingOutput(
  value: unknown,
  options: { taskType?: string } = {},
): MeetingQualityReport {
  const data = asRecord(value) ?? {};
  const issues: QualityIssue[] = [];
  const agenda = assessAgenda(data.agenda);
  const sberActions = assessSberActions(data.sberActions);
  const requiresAgenda = sectionIsRequired("agenda", options.taskType, data.sectionOrder);
  const requiresSber = sectionIsRequired("sber", options.taskType, data.sectionOrder);

  for (const field of ["meetingGoal", "mainThesis", "proposal"] as const) {
    if (!isNonEmptyString(data[field])) {
      issues.push({
        code: `meeting.${field}.empty`,
        message: `Обязательное поле ${field} не заполнено`,
        path: field,
      });
    }
  }

  if (requiresAgenda && !agenda.ready) {
    issues.push({
      code: "meeting.agenda.incomplete",
      message: `Сценарий встречи заполнен не полностью: ${agenda.complete} из ${agenda.total} строк`,
      path: "agenda",
    });
  }

  if (requiresSber && !sberActions.ready) {
    issues.push({
      code: "meeting.sberActions.incomplete",
      message: `Действия Сбера заполнены не полностью: ${sberActions.complete} из ${sberActions.total} строк`,
      path: "sberActions",
    });
  }
  if (options.taskType === "meeting_preparation") {
    const ladder = asRecord(data.askLadder);
    if (!ladder || !isNonEmptyString(ladder.target) || !isNonEmptyString(ladder.min)) {
      issues.push({
        code: "meeting.askLadder.incomplete",
        message: "Лестница запросов должна содержать целевой и минимальный исход",
        path: "askLadder",
      });
    }
  }

  const deductions = issues.reduce((sum, issue) => {
    if (issue.code === "meeting.agenda.incomplete") return sum + 30;
    if (issue.code === "meeting.sberActions.incomplete") return sum + 25;
    return sum + 15;
  }, 0);

  return {
    ready: issues.length === 0,
    score: Math.max(0, 100 - deductions),
    issues,
    agenda,
    sberActions,
  };
}

export type TypedOutputQualityReport = {
  ready: boolean;
  score: number;
  issues: QualityIssue[];
};

export function assessTypedOutput(
  value: unknown,
  options: { taskType?: string } = {},
): TypedOutputQualityReport {
  const output = asRecord(value);
  const kind = typeof output?.kind === "string" ? output.kind : "";
  const data = asRecord(output?.data) ?? {};
  if (kind === "meeting") return assessMeetingOutput(data, options);

  const issues: QualityIssue[] = [];
  const requireText = (field: string, label = field) => {
    if (!isNonEmptyString(data[field])) {
      issues.push({ code: `${kind}.${field}.empty`, message: `${label} не заполнено`, path: field });
    }
  };
  const requireArray = (field: string, minimum: number, label = field) => {
    const total = Array.isArray(data[field]) ? data[field].length : 0;
    if (total < minimum) {
      issues.push({ code: `${kind}.${field}.short`, message: `${label}: ${total}, требуется не менее ${minimum}`, path: field });
    }
  };

  if (kind === "region") {
    const summary = asRecord(data.regionSummary);
    const budget = asRecord(data.budgetLandscape);
    const priorities = asRecord(data.strategicPriorities);
    if (!isNonEmptyString(summary?.name)) issues.push({ code: "region.summary.empty", message: "Регион не определён" });
    if (!budget || (!isNonEmptyString(budget.totalBudget) && typeof budget.totalIncomeValue !== "number")) {
      issues.push({ code: "region.budget.empty", message: "Бюджетная рамка не заполнена" });
    }
    requireArray("industryBreakdown", 2, "Отрасли");
    requireArray("regionalScenarios", 3, "Сценарии");
    const confirmed = Array.isArray(priorities?.confirmed) ? priorities.confirmed.length : 0;
    if (confirmed < 1) issues.push({ code: "region.priorities.empty", message: "Нет подтверждённых приоритетов" });
    requireArray("sources", 5, "Источники");
  } else if (kind === "brief") {
    requireText("decision", "Решение");
    requireText("economics", "Экономика");
    requireArray("evidence", 3, "Доказательства");
    requireArray("sources", 3, "Источники");
    const next = asRecord(data.nextStep);
    if (!next || !isNonEmptyString(next.action) || !isNonEmptyString(next.owner) || !isNonEmptyString(next.deadline)) {
      issues.push({ code: "brief.nextStep.incomplete", message: "Следующий шаг должен содержать действие, владельца и срок" });
    }
  } else if (kind === "strategy") {
    requireText("decision", "Решение");
    requireArray("bets", 3, "Стратегические ставки");
    requireArray("nextSteps", 1, "Следующие шаги");
    requireArray("sources", 3, "Источники");
    if (options.taskType === "sber_region_strategy") {
      const actions = assessSberActions(data.sberActions);
      if (!actions.ready) issues.push({ code: "strategy.sberActions.incomplete", message: "Действия Сбера не заполнены" });
    }
  } else {
    issues.push({ code: "output.kind.unsupported", message: "Тип результата не поддерживается quality gate" });
  }

  const score = Math.max(0, 100 - issues.length * 18);
  return { ready: issues.length === 0, score, issues };
}

/**
 * Numeric clauses are allowed in a factual tile only when every explicit number
 * from that clause is present in the cited source excerpt/title. Clauses without
 * numbers are preserved; unsupported numeric clauses are removed conservatively.
 */
export function stripUnsupportedNamedParentheticals(text: string, evidence: string): string {
  const evidenceLower = evidence.toLowerCase();
  return text.replace(/\(([^)]+)\)/gu, (full, content: string) => {
    const names = content.match(/[А-ЯЁ][а-яё]{3,}/gu) ?? [];
    if (names.some((name) => !evidenceLower.includes(name.toLowerCase()))) return "";
    return full;
  }).replace(/\s{2,}/g, " ").trim();
}

export function normalizeFactualProse(text: string): string {
  return text
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.split(/\s+/).length >= 3)
    .map((sentence) => sentence.charAt(0).toUpperCase() + sentence.slice(1))
    .join(" ")
    .trim();
}

export function stripUnsupportedNumericClauses(text: string, evidence: string): string {
  const normalizedEvidence = normalizeNumericText(evidence);
  const clauses = text
    .split(/(?<=[.!?;])\s+|\s*;\s*/u)
    .map((part) => part.trim())
    .filter(Boolean);

  const kept = clauses.filter((clause) => {
    const tokens = numericTokens(clause);
    if (tokens.length === 0) return true;
    return tokens.every((token) => normalizedEvidence.includes(token));
  });

  return kept.join(" ").trim();
}

export function sanitizeNegotiationCommitments(text: string): string {
  return text
    .replace(/в\s+(?:одном\s+)?муниципалитете\s*[—–-]\s*[А-ЯЁ][А-Яа-яЁё-]+/gu, "в согласованной пилотной зоне")
    .replace(/в\s+муниципалитете\s+[А-ЯЁ][А-Яа-яЁё-]+/gu, "в согласованной пилотной зоне")
    // Любая формулировка самоназначения куратора моделью («назначаем»,
    // «будет», «станет», «выступит», «является») — это переговорная позиция
    // заказчика, а не факт; нейтрализуем независимо от глагола.
    .replace(
      /куратором\s+(?:назначаем|будет|станет|выступит|выступает|является)\s+[^.]+\.?/giu,
      "Куратора проекта определяет заказчик. ",
    )
    .replace(/без\s+дополнительных\s+капитальных\s+вложений,?/giu, "")
    .replace(/\s+([,.])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const NAMED_HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&quot;": '"',
  "&apos;": "'",
  "&lt;": "<",
  "&gt;": ">",
  "&nbsp;": " ",
};

/**
 * Разово декодирует HTML-сущности (числовые hex/dec и именованные) в тексте.
 * Порядок замены в одном проходе не важен: regex сканирует непересекающиеся
 * совпадения слева-направо, поэтому `&amp;#x417;` в первом проходе даёт
 * `&#x417;` (совпал только `&amp;`), а во втором проходе декодируется в букву.
 */
function decodeHtmlEntitiesOnce(text: string): string {
  return text.replace(
    /&#x([0-9a-fA-F]+);|&#(\d+);|&(?:amp|quot|apos|lt|gt|nbsp);/g,
    (match, hex?: string, dec?: string) => {
      if (hex) {
        const code = Number.parseInt(hex, 16);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      if (dec) {
        const code = Number.parseInt(dec, 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      return NAMED_HTML_ENTITIES[match] ?? match;
    },
  );
}

/**
 * Очищает название/выдержку источника от артефактов веб-скрейпинга:
 * HTML-сущности (в т.ч. двойное кодирование `&amp;#x417;`), wiki-шаблоны
 * `{{...}}`, wiki-ссылки `[[...]]`/`[[url|текст]]` и теги `<ref>...</ref>`.
 * Нормальные короткие ссылки вида `[rbc.ru]` (одиночные скобки) не трогает.
 */
export function cleanSourceText(text: string): string {
  if (typeof text !== "string" || !text) return "";
  // Два прохода декодирования HTML-сущностей закрывают двойное кодирование.
  let result = decodeHtmlEntitiesOnce(text);
  result = decodeHtmlEntitiesOnce(result);

  result = result
    // Wiki-шаблоны вида {{Wayback|url=...}} — удаляем целиком.
    .replace(/\{\{[^{}]*\}\}/gu, "")
    // Теги <ref ...>...</ref> и самозакрывающиеся <ref .../>.
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref\s*>/giu, "")
    .replace(/<ref\b[^>]*\/>/giu, "")
    // Wiki-ссылки [[ссылка|видимый текст]] → видимый текст; [[текст]] → текст.
    .replace(/\[\[([^[\]|]*)\|([^[\]]+)\]\]/gu, "$2")
    .replace(/\[\[([^[\]]+)\]\]/gu, "$1")
    // Остаточные НЕПАРНЫЕ wiki-скобки (напр. «[[rbc.ru] …]» с одной закрывающей).
    .replace(/\[\[|\]\]|\{\{|\}\}/gu, " ")
    // Висячие/неполные HTML-сущности: если заголовок усекли по длине посреди
    // «&#x…;» ещё ДО декодирования, остаётся хвост вроде «&#x4» — вырезаем.
    .replace(/&#x?[0-9A-Fa-f]*;?/gu, "");

  return result.replace(/\s{2,}/g, " ").trim();
}

export function stripDecorativeSymbols(text: string): string {
  return text
    .replace(/[0-9#*]?\uFE0F?\u20E3/gu, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Единицы, после которых число считается высокорисковым коммерческим/
// демографическим утверждением: деньги, доли, а также масштаб (жители,
// обращения, муниципалитеты) — то, что модель любит домысливать без evidence.
const HIGH_RISK_NUMBER_UNIT =
  /(?:%|₽|руб(?:лей|ля|ль)?|млрд|млн|трлн|тыс(?:яч)?|жител(?:ей|я|ь|и)?|человек|обращени(?:й|е|я|ям)?|муниципалитет(?:ов|а|е)?)/;

export function stripUnsupportedHighRiskClauses(text: string, evidence: string): string {
  const evidenceChunks = evidence.split(/\n+/).map((chunk) => chunk.trim()).filter(Boolean);
  const clauses = text
    .split(/(?<=[.!?;])\s+|\s*;\s*/u)
    .map((part) => part.trim())
    .filter(Boolean);
  const kept = clauses.filter((clause) => {
    const matches =
      clause.match(new RegExp(`[≈~]?\\d[\\d\\s.,]*\\s*${HIGH_RISK_NUMBER_UNIT.source}`, "giu")) ?? [];
    if (matches.length === 0) return true;
    const numberTokens = matches.map(normalizeNumericText);
    const claimWords = significantWords(clause);
    return evidenceChunks.some((chunk) => {
      const normalizedChunk = normalizeNumericText(chunk);
      if (!numberTokens.every((token) => normalizedChunk.includes(token))) return false;
      const chunkLower = chunk.toLowerCase();
      const overlap = claimWords.filter((word) => chunkLower.includes(word)).length;
      return overlap >= Math.min(2, claimWords.length);
    });
  });
  return kept.join(" ").trim();
}

/**
 * Точечный вариант stripUnsupportedHighRiskClauses для полей, которые не
 * должны стать пустыми целиком (обязательные поля sberActions): вырезает
 * только сам неподтверждённый числовой токен (число + единица риска) внутри
 * предложения, не удаляя всю клаузу и окружающий текст. Используется как
 * консервативный fallback, когда клаузное удаление опустошило бы поле.
 */
export function stripUnsupportedRiskNumberTokens(text: string, evidence: string): string {
  const evidenceLower = normalizeNumericText(evidence);
  const pattern = new RegExp(`[≈~]?\\d[\\d\\s.,]*\\s*${HIGH_RISK_NUMBER_UNIT.source}`, "giu");
  const result = text.replace(pattern, (token) => (evidenceLower.includes(normalizeNumericText(token)) ? token : ""));
  return result
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function deriveFiscalStance(
  income: number,
  expense: number,
): { kind: "deficit" | "surplus" | "balanced"; delta: number } | null {
  if (!Number.isFinite(income) || !Number.isFinite(expense)) return null;
  const delta = Math.round(Math.abs(income - expense) * 10) / 10;
  if (expense > income) return { kind: "deficit", delta };
  if (income > expense) return { kind: "surplus", delta };
  return { kind: "balanced", delta: 0 };
}

export function hasSupportedFiscalStance(text: string, evidence: string): boolean {
  const lower = text.toLowerCase();
  const evidenceLower = evidence.toLowerCase();
  const stances = ["профицит", "дефицит"];
  return stances.every((stance) => !lower.includes(stance) || evidenceLower.includes(stance));
}

function significantWords(text: string): string[] {
  const stop = new Set([
    "который", "которая", "которые", "будет", "составит", "рублей", "бюджета",
    "проект", "пилот", "через", "после", "этого", "этой", "также", "одного",
  ]);
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .split(/[^a-zа-яё0-9]+/u)
        .filter((word) => word.length >= 5 && !stop.has(word) && !/^\d/.test(word)),
    ),
  ).slice(0, 8);
}

function numericTokens(text: string): string[] {
  const matches = text.match(/\d[\d\s.,]*(?:\s*(?:%|₽|руб(?:лей|ля|ль)?|млрд|млн|тыс|год(?:а|у|ом)?))?/giu) ?? [];
  return Array.from(
    new Set(
      matches
        .map((token) => normalizeNumericText(token))
        .filter((token) => token.length > 0),
    ),
  );
}

function normalizeNumericText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[≈~]/g, "")
    .replace(/[\u00a0\u202f\s]+/g, "")
    .replace(/,/g, ".")
    .replace(/руб(?:лей|ля|ль)?/g, "₽");
}
