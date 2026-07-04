import type {
  RegionAnalysisOutput,
  BudgetLandscape,
  IndustryBreakdown,
  BudgetBreakdownItem,
  BudgetProgram,
  Competitor,
  DataGap,
  RegionalScenario,
  RegionStakeholder,
} from "@/lib/schemas/structured-output";

interface GuardEvidence {
  title: string;
  url: string;
  snippet?: string | null;
  source?: string | null;
  fullText?: string | null;
}
const PLACEHOLDER_PATTERNS = [
  /\bunknown\b/gi,
  /\bn\/a\b/gi,
  /нужно снять/gi,
  /нужно подтвердить/gi,
  /требует проверки/gi,
  /требует уточнения/gi,
  /не подтвержден[аоы]?/gi,
  /не найден[аоы]?/gi,
  /не указано/gi,
  /нет данных/gi,
  /данные отсутствуют/gi,
  /уточнить/gi,
  /todo/gi,
  /fixme/gi,
];

const EMPTY_ANALYSIS_PATTERNS = [
  /в (?:представленных )?источниках нет/gi,
  /нет (?:конкретных |прямых )?(?:данных|сведений|упоминаний)/gi,
  /не содержит данных/gi,
  /не содержит сведений/gi,
  /без детализации/gi,
  /не раскрыт[аоы]?/gi,
  /не представлено/gi,
  /только общие сведения/gi,
];

const BUZZWORDS = [
  "единая платформа",
  "цифровой двойник",
  "platform v",
  "комплексная цифровизация",
  "all-in-one",
];

// --- Региональность стейкхолдеров и нормализация меток (уровень данных, не только UI) ---
const FEDERAL_ROLE_RE =
  /правительств[ао]\s+рф|российской федерации|федеральн(?:ый|ого|ая|ой|ые|ых)|госдум|государственн(?:ая|ой)\s+дум|совет\s+федерации|сенатор|министр\s+рф|вице[-\s]?премьер|заместител[ья]\s+председателя\s+правительства\s+рф/i;

function isFederalStakeholder(role?: string, department?: string): boolean {
  const text = `${role ?? ""} ${department ?? ""}`.replace(/[‐‑‒–—-]/g, " ");
  return FEDERAL_ROLE_RE.test(text);
}

function hasFullPersonName(name?: string): boolean {
  // Принимаем «Имя Фамилия» (2 слова) и «Имя Отчество Фамилия» (3). Требование
  // ровно 3 слов заставляло выдумывать отчество (неверное) или терять реального
  // руководителя, названного двумя словами. «Именными» считаем только слова с
  // заглавной буквы — так отсекаются служебные фразы («министр финансов»).
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const nameLike = parts.filter((p) => /^[А-ЯЁA-Z][А-Яа-яЁёA-Za-z.-]+$/.test(p));
  return nameLike.length >= 2;
}

const PROBABILITY_NORM: Record<string, "high" | "medium" | "low"> = {
  high: "high", "высокая": "high", "высокий": "high", "высок": "high", "medium-high": "high",
  medium: "medium", "средняя": "medium", "средний": "medium", "средн": "medium",
  "medium-low": "low", "low-medium": "low",
  low: "low", "низкая": "low", "низкий": "low", "низк": "low",
};

function normalizeProbability(value: unknown): "high" | "medium" | "low" {
  const key = String(value ?? "").trim().toLowerCase();
  return PROBABILITY_NORM[key] ?? "medium";
}

const THREAT_RU: Record<string, string> = {
  high: "высокий", "medium-high": "высокий",
  medium: "средний",
  "medium-low": "средний", "low-medium": "низкий",
  low: "низкий",
};

function normalizeThreatLevel(value: unknown): string {
  const raw = String(value ?? "").trim();
  return THREAT_RU[raw.toLowerCase()] ?? raw;
}

function hasPlaceholder(value: string) {
  return [...PLACEHOLDER_PATTERNS, ...EMPTY_ANALYSIS_PATTERNS].some((re) => {
    re.lastIndex = 0;
    return re.test(value);
  });
}

function cleanPlaceholder(value: unknown, fallback = ""): string {
  if (!value) return fallback;
  let cleaned = Array.isArray(value)
    ? value.map((item) => (typeof item === "string" ? item : JSON.stringify(item))).join("; ")
    : typeof value === "string"
      ? value
      : String(value);
  [...PLACEHOLDER_PATTERNS, ...EMPTY_ANALYSIS_PATTERNS].forEach((re) => {
    cleaned = cleaned.replace(re, fallback);
  });
  return cleaned.trim();
}

function cleanTechnicalMarker(value: string): string {
  const normalized = value.trim();
  if (/^(unknown|n\/a|todo|fixme)$/i.test(normalized)) return "";
  if (/^hypothesis$/i.test(normalized)) return "Гипотеза для подтверждения источником";
  return value
    .replace(/\bunknown\b/gi, "")
    .replace(/\bn\/a\b/gi, "")
    .replace(/\bhypothesis\b/gi, "гипотеза")
    .replace(/\btodo\b|\bfixme\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function sanitizeTechnicalMarkers<T>(value: T): T {
  if (typeof value === "string") return cleanTechnicalMarker(value) as T;
  if (Array.isArray(value)) return value.map((item) => sanitizeTechnicalMarkers(item)) as T;
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = sanitizeTechnicalMarkers(item);
    }
    return result as T;
  }
  return value;
}

function containsBuzzword(text: string | null | undefined): boolean {
  if (typeof text !== "string") return false;
  const lower = text.toLowerCase();
  return BUZZWORDS.some((w) => lower.includes(w));
}

function containsNumber(text: string | null | undefined): boolean {
  if (typeof text !== "string") return false;
  return /\b\d[\d\s.,]*\s*(млрд|млн|трлн|тыс|%|руб|₽|год|чел|человек|долл|евро|шт|единиц|км|м²|га|проц)/i.test(
    text,
  );
}

function findEvidenceFor(text: string, evidence: GuardEvidence[]): GuardEvidence | undefined {
  const lower = text.toLowerCase();
  const score = (item: GuardEvidence): number => {
    const snippet = (item.snippet || "").toLowerCase();
    const full = (item.fullText || "").toLowerCase();
    let s = 0;
    const numericMatches = (str: string) =>
      (str.match(/\b\d[\d\s.,]*\s*(млрд|млн|трлн|тыс|%|руб|₽)/gi) || []).length;
    s += numericMatches(snippet) * 2;
    s += numericMatches(full);
    const tokens = lower.split(/\s+/).filter(Boolean);
    for (const token of tokens) {
      if (token.length <= 3) continue;
      if (snippet.includes(token) || full.includes(token)) s += 1;
    }
    if (item.source === "zakupki.gov.ru" && /закуп|контракт|поставщик/i.test(text)) s += 5;
    if (item.source === "ru.wikipedia.org" && /врп|население|экономика|отрасл/i.test(text)) s += 4;
    return s;
  };
  const scored = evidence
    .map((e) => ({ e, s: score(e) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  return scored[0]?.e;
}

function buildSourceCitation(item: GuardEvidence): { source: string; sourceUrl: string; evidence: string } {
  const domain = item.source || item.url.replace(/^https?:\/\/(www\.)?/i, "").split("/")[0];
  const snippet = (item.snippet || "").slice(0, 180).replace(/\s+/g, " ");
  return {
    source: domain,
    sourceUrl: item.url,
    evidence: snippet,
  };
}

function asArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function normalizeRegionOutput(output: RegionAnalysisOutput): RegionAnalysisOutput {
  const normalized = output as RegionAnalysisOutput & {
    budgetLandscape?: Partial<BudgetLandscape>;
    strategicPriorities?: Partial<RegionAnalysisOutput["strategicPriorities"]>;
  };

  return {
    ...normalized,
    industryBreakdown: asArray(normalized.industryBreakdown),
    budgetLandscape: {
      totalBudget: normalized.budgetLandscape?.totalBudget ?? "",
      itShare: normalized.budgetLandscape?.itShare ?? "",
      keyPrograms: asArray(normalized.budgetLandscape?.keyPrograms),
      upcomingTenders: normalized.budgetLandscape?.upcomingTenders ?? "",
      dataNeeded: normalized.budgetLandscape?.dataNeeded ?? "",
      breakdown: asArray(normalized.budgetLandscape?.breakdown),
      totalIncomeValue: normalized.budgetLandscape?.totalIncomeValue,
      totalExpenseValue: normalized.budgetLandscape?.totalExpenseValue,
      history: normalized.budgetLandscape?.history,
      aiHighlights: asArray(normalized.budgetLandscape?.aiHighlights),
    },
    regionalScenarios: asArray(normalized.regionalScenarios),
    claims: asArray(normalized.claims),
    keyPlayers: asArray(normalized.keyPlayers),
    strategyRealityGap: asArray(normalized.strategyRealityGap),
    emergingOpportunities: asArray(normalized.emergingOpportunities),
    stakeholderMap: asArray(normalized.stakeholderMap),
    competitiveLandscape: asArray(normalized.competitiveLandscape),
    entryPoints: asArray(normalized.entryPoints),
    strategicPriorities: {
      confirmed: asArray(normalized.strategicPriorities?.confirmed),
      hypothesized: asArray(normalized.strategicPriorities?.hypothesized),
      source: normalized.strategicPriorities?.source ?? "",
      roadmap: asArray(normalized.strategicPriorities?.roadmap),
    },
    dataGaps: asArray(normalized.dataGaps),
    risks: asArray(normalized.risks),
    nextSteps: asArray(normalized.nextSteps),
    visuals: asArray(normalized.visuals),
    sources: asArray(normalized.sources),
    hypotheses: asArray(normalized.hypotheses),
  };
}

export function sanitizeRegionOutput(output: RegionAnalysisOutput): RegionAnalysisOutput {
  const sanitized: RegionAnalysisOutput = normalizeRegionOutput(JSON.parse(JSON.stringify(output)));

  sanitized.industryBreakdown = sanitized.industryBreakdown.map((ind) => {
    const cleaned: IndustryBreakdown = {
      ...ind,
      currentDigitalState: cleanPlaceholder(
        ind.currentDigitalState,
        "",
      ),
      keyEnterprises: asArray(ind.keyEnterprises).filter((enterprise) => {
        const text = `${enterprise.name ?? ""} ${enterprise.description ?? ""}`;
        return text.trim().length > 0 && !hasPlaceholder(text);
      }),
      limitations: asArray(ind.limitations)
        .map((item) => cleanPlaceholder(item, ""))
        .filter(Boolean),
      sberRelevance: cleanPlaceholder(ind.sberRelevance, ""),
    };
    return cleaned;
  });

  if (sanitized.budgetLandscape) {
    sanitized.budgetLandscape.totalBudget = cleanPlaceholder(
      sanitized.budgetLandscape.totalBudget,
      "",
    );
    sanitized.budgetLandscape.itShare = cleanPlaceholder(
      sanitized.budgetLandscape.itShare,
      "",
    );
    sanitized.budgetLandscape.dataNeeded = cleanPlaceholder(
      sanitized.budgetLandscape.dataNeeded,
      "",
    );
    sanitized.budgetLandscape.keyPrograms = sanitized.budgetLandscape.keyPrograms.map((p) => ({
      ...p,
      budget: cleanPlaceholder(p.budget),
      status: cleanPlaceholder(p.status),
      sberRelevance: cleanPlaceholder(p.sberRelevance),
    }));
    if (sanitized.budgetLandscape.breakdown) {
      sanitized.budgetLandscape.breakdown = sanitized.budgetLandscape.breakdown
        .filter((b) => Number.isFinite(b.value) && b.value > 0)
        .map((b) => ({
          ...b,
          share: cleanPlaceholder(b.share ?? "", ""),
        }));
    }
  }

  // Только подтверждённые РЕГИОНАЛЬНЫЕ лица: полное ФИО (>=3 слов),
  // без федеральных чиновников и без плейсхолдеров. Иначе федеральные визитёры
  // (напр. вице-премьеры) и заглушки утекали в экспорт/память через данные.
  sanitized.stakeholderMap = sanitized.stakeholderMap
    .filter((s) => {
      if (isFederalStakeholder(s.role, s.department)) return false;
      if (!hasFullPersonName(s.name)) return false;
      if (hasPlaceholder(String(s.name ?? ""))) return false;
      return true;
    })
    .map((s) => {
      const cleaned: RegionStakeholder = {
        ...s,
        name: cleanPlaceholder(s.name),
        role: cleanPlaceholder(s.role),
        department: cleanPlaceholder(s.department),
        achievements: cleanPlaceholder(s.achievements, ""),
        recentNews: cleanPlaceholder(s.recentNews, ""),
        managementInterest: cleanPlaceholder(s.managementInterest, ""),
        relationshipToSber: cleanPlaceholder(s.relationshipToSber, ""),
        engagementPrinciple: cleanPlaceholder(s.engagementPrinciple, ""),
      };
      return cleaned;
    });

  sanitized.competitiveLandscape = sanitized.competitiveLandscape.map((c) => {
    const cleaned: Competitor = { ...c };
    cleaned.threatLevel = normalizeThreatLevel(c.threatLevel);
    if (containsBuzzword(c.product) || containsBuzzword(c.where) || containsBuzzword(c.sberAdvantage)) {
      cleaned.evidence = cleaned.evidence && typeof cleaned.evidence === "string"
        ? `${cleaned.evidence} (buzzword; проверить источник)`
        : "Проверить источник на формулировки 'единая платформа / цифровой двойник / Platform V'";
    }
    if (!c.evidence || (typeof c.evidence === "string" && hasPlaceholder(c.evidence))) {
      cleaned.incumbentPosition = cleaned.incumbentPosition || "отраслевая гипотеза, региональное присутствие нужно проверить";
    }
    return cleaned;
  });

  sanitized.strategicPriorities.confirmed = sanitized.strategicPriorities.confirmed.map((text) =>
    cleanPlaceholder(text, ""),
  );
  sanitized.strategicPriorities.hypothesized = sanitized.strategicPriorities.hypothesized.map((text) =>
    cleanPlaceholder(text, ""),
  );

  if (sanitized.regionalScenarios) {
    sanitized.regionalScenarios = sanitized.regionalScenarios.map((sc) => {
      const cleaned: RegionalScenario = { ...sc };
      cleaned.probability = normalizeProbability(sc.probability);
      cleaned.budgetImplication = cleanPlaceholder(sc.budgetImplication);
      cleaned.industryImpact = cleanPlaceholder(sc.industryImpact);
      cleaned.sberPosture = cleanPlaceholder(sc.sberPosture);
      return cleaned;
    });
  }

  return sanitizeTechnicalMarkers(sanitized);
}

export function guardRegionOutput(
  output: RegionAnalysisOutput,
  evidence: GuardEvidence[],
): RegionAnalysisOutput {
  const guarded = sanitizeRegionOutput(output);
  const gaps: DataGap[] = [];

  guarded.industryBreakdown = guarded.industryBreakdown.map((ind) => {
    const cleaned: IndustryBreakdown = { ...ind };
    if (containsBuzzword(`${cleaned.name} ${cleaned.sberRelevance} ${cleaned.currentDigitalState}`) && !cleaned.source) {
      gaps.push({
        id: `gap-buzz-${cleaned.id}`,
        question: `Проверить источник buzzword-формулировок для ${cleaned.name}`,
        howToGet: "Найти конкретный контракт/закупку/публикацию заказчика",
        priority: "medium",
        owner: "аналитик",
      });
    }
    return cleaned;
  });

  if (guarded.budgetLandscape?.breakdown) {
    guarded.budgetLandscape.breakdown = guarded.budgetLandscape.breakdown.map((item) => {
      const cleaned: BudgetBreakdownItem = { ...item };
      if (!cleaned.source) {
        const ev = findEvidenceFor(`${item.name} ${item.value}`, evidence);
        if (ev) {
          cleaned.source = ev.source || ev.url;
          cleaned.sourceUrl = ev.url;
        }
      }
      return cleaned;
    });
  }

  guarded.budgetLandscape.keyPrograms = guarded.budgetLandscape.keyPrograms.map((p) => {
    const cleaned: BudgetProgram = { ...p };
    if (containsNumber(cleaned.budget) && !cleaned.source) {
      const ev = findEvidenceFor(`${cleaned.name} ${cleaned.budget}`, evidence);
      if (ev) {
        cleaned.source = ev.source || ev.url;
        cleaned.sourceUrl = ev.url;
      }
    }
    return cleaned;
  });

  guarded.competitiveLandscape = guarded.competitiveLandscape.map((c) => {
    const cleaned: Competitor = { ...c };
    if ((containsBuzzword(c.product) || containsBuzzword(c.where)) && !c.evidence?.length) {
      cleaned.product = `${c.product} [гипотеза: требуется источник]`;
      cleaned.threatLevel = c.threatLevel.toLowerCase().includes("высок") ? "низкий / не подтвержден" : c.threatLevel;
    }
    return cleaned;
  });

  if (guarded.regionalScenarios) {
    guarded.regionalScenarios = guarded.regionalScenarios.map((sc) => {
      const cleaned: RegionalScenario = { ...sc };
      if (containsNumber(sc.budgetImplication) && (!sc.evidence || sc.evidence.length === 0)) {
        const ev = findEvidenceFor(`${sc.title} ${sc.budgetImplication} ${sc.industryImpact}`, evidence);
        if (ev) {
          cleaned.sources = cleaned.sources || [];
          cleaned.sources.push({
            title: ev.title,
            url: ev.url,
            excerpt: (ev.snippet || "").slice(0, 220),
          });
        } else {
          gaps.push({
            id: `gap-scenario-${sc.id}`,
            question: `Подтвердить цифры в сценарии «${sc.title}»`,
            howToGet: "Бюджетные документы / стратегия / макро-прогнозы",
            priority: "medium",
            owner: "аналитик",
          });
        }
      }
      return cleaned;
    });
  }

  if (guarded.strategicPriorities.roadmap) {
    guarded.strategicPriorities.roadmap = guarded.strategicPriorities.roadmap.map((p) => {
      if (!p.source) {
        const ev = findEvidenceFor(p.title, evidence);
        if (ev) {
          return { ...p, source: ev.source || ev.url };
        }
      }
      return p;
    });
  }

  const existingGapQuestions = new Set(guarded.dataGaps.map((g) => g.question));
  for (const gap of gaps) {
    if (!existingGapQuestions.has(gap.question)) {
      guarded.dataGaps.push(gap);
    }
  }

  guarded.hypotheses = Array.from(new Set([...guarded.hypotheses, ...gaps.map((g) => g.question)]));

  return guarded;
}
