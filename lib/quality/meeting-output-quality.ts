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

export function stripUnsupportedHighRiskClauses(text: string, evidence: string): string {
  const evidenceChunks = evidence.split(/\n+/).map((chunk) => chunk.trim()).filter(Boolean);
  const clauses = text
    .split(/(?<=[.!?;])\s+|\s*;\s*/u)
    .map((part) => part.trim())
    .filter(Boolean);
  const kept = clauses.filter((clause) => {
    const matches = clause.match(/\d[\d\s.,]*\s*(?:%|₽|руб(?:лей|ля|ль)?|млрд|млн|трлн)/giu) ?? [];
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
    .replace(/[\u00a0\u202f\s]+/g, "")
    .replace(/,/g, ".")
    .replace(/руб(?:лей|ля|ль)?/g, "₽");
}
