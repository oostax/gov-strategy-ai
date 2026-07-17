import type {
  AskLadder,
  BriefOutput,
  LprDossier,
  LprTile,
  MeetingOutput,
  MeetingOutcome,
  MeetingParticipant,
  MinistryPortrait,
  NextStep,
  Objection,
  Source,
  SourceTier,
  StrategyBet,
  StructuredOutput,
  TypedOutput,
} from "@/lib/schemas/structured-output";
import { cleanSourceText } from "@/lib/quality/meeting-output-quality";

/**
 * Обобщённый рендер структурированного вывода в документ.
 *
 * Любой TypedOutput превращается в упорядоченный список секций
 * ({heading, блоки текста/таблицы}), из которого строятся docx / pptx / pdf.
 * Секции идут в том же порядке, что и на дашборде, чтобы документ повторял экран.
 *
 * kind="region" здесь НЕ обрабатывается — для региона сохранён отдельный путь
 * (toRegionAgentOutput / buildRegionPdf), см. region-export.ts.
 */

// ── Модель документа ─────────────────────────────────────────────────────────

export interface DocTableBlock {
  kind: "table";
  headers: string[];
  rows: string[][];
}

export interface DocParagraphBlock {
  kind: "paragraphs";
  lines: string[];
  /** Рендерить как маркированный список (иначе — обычные абзацы). */
  bullet?: boolean;
}

export type DocBlock = DocParagraphBlock | DocTableBlock;

export interface DocSection {
  heading: string;
  /** Короткое пояснение под заголовком (курсивом). */
  note?: string;
  blocks: DocBlock[];
}

export interface DocModel {
  title: string;
  subtitle?: string;
  sections: DocSection[];
}

// ── Утилиты ────────────────────────────────────────────────────────────────

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

function clean(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

const TIER_LABEL: Record<SourceTier, string> = {
  fact: "Факт",
  hypothesis: "Гипотеза",
  crm: "Из CRM",
  ask: "Спросить",
};

function tierLabel(tier?: SourceTier): string {
  return tier ? TIER_LABEL[tier] ?? "" : "";
}

/** «Текст [Факт]» — добавляет метку тиера к строке, если она задана. */
function withTier(text: string, tier?: SourceTier): string {
  const label = tierLabel(tier);
  const body = clean(text);
  if (!body) return "";
  return label ? `${body} [${label}]` : body;
}

/**
 * Название источника из уже сохранённых сессий может содержать HTML-сущности
 * или wiki-разметку (данные пришли из веб-скрейпинга до внедрения очистки в
 * assembler.ts). Прогоняем через cleanSourceText здесь же, на рендере
 * экспорта, чтобы починить старые stored output без миграции данных.
 */
function sourceRef(source?: Source): string {
  if (!source) return "";
  const title = clean(cleanSourceText(source.title));
  const url = clean(source.url);
  if (title && url) return `${title} — ${url}`;
  return title || url || "";
}

/** Список «Действие — Владелец, Срок» из массива NextStep. */
function nextStepLines(steps: NextStep[] | undefined): string[] {
  return (steps ?? [])
    .filter((s) => nonEmpty(s.action))
    .map((s) => {
      const meta = [clean(s.owner), clean(s.deadline)].filter(Boolean).join(", ");
      return meta ? `${clean(s.action)} — ${meta}` : clean(s.action);
    });
}

function paragraphs(lines: (string | undefined)[], bullet = false): DocParagraphBlock | null {
  const filtered = lines.map((l) => clean(l)).filter(Boolean);
  if (!filtered.length) return null;
  return { kind: "paragraphs", lines: filtered, bullet };
}

function table(headers: string[], rows: string[][]): DocTableBlock | null {
  const filtered = rows.filter((row) => row.some((cell) => clean(cell)));
  if (!filtered.length) return null;
  return { kind: "table", headers, rows: filtered.map((row) => row.map((cell) => clean(cell))) };
}

function pushSection(sections: DocSection[], heading: string, blocks: (DocBlock | null)[], note?: string) {
  const real = blocks.filter((b): b is DocBlock => b !== null);
  if (!real.length) return;
  sections.push({ heading, note, blocks: real });
}

// ── Общий блок «Источники» ───────────────────────────────────────────────────

function sourcesSection(sources: Source[] | undefined, hypotheses?: string[]): DocSection | null {
  const srcLines = (sources ?? [])
    .map((s) => {
      const ref = sourceRef(s);
      const mark = s.isVerified ? "Факт" : "Требует проверки";
      const excerpt = clean(cleanSourceText(s.excerpt));
      const base = ref || excerpt;
      if (!base) return "";
      const tail = excerpt && ref ? ` — ${excerpt}` : "";
      return `${base}${tail} [${mark}]`;
    })
    .filter(Boolean);
  const hypLines = (hypotheses ?? []).map((h) => clean(h)).filter(Boolean);
  const blocks: (DocBlock | null)[] = [paragraphs(srcLines, true)];
  if (hypLines.length) {
    blocks.push({ kind: "paragraphs", lines: ["Гипотезы для проверки:"] });
    blocks.push(paragraphs(hypLines, true));
  }
  const real = blocks.filter((b): b is DocBlock => b !== null);
  if (!real.length) return null;
  return { heading: "Источники", blocks: real };
}

function sberActionsBlocks(actions: StructuredOutput["sberActions"]): DocBlock | null {
  const rows = (actions ?? [])
    .filter((a) => nonEmpty(a.asset) || nonEmpty(a.firstTwoWeeks))
    .map((a) => [
      clean(a.asset),
      clean(a.firstTwoWeeks),
      clean(a.dataNeeded),
      clean(a.artifact),
      clean(a.commercialNextStep),
    ]);
  return table(
    ["Актив Сбера", "Первые 2 недели", "Нужные данные", "Что отдаём", "Следующий шаг"],
    rows,
  );
}

// ── meeting ────────────────────────────────────────────────────────────────

function buildMeetingSections(data: MeetingOutput): DocSection[] {
  const sections: DocSection[] = [];

  // 1. Цель + лестница запросов + тезис / предложение / артефакт
  const ladder: AskLadder | undefined = data.askLadder;
  const goalLines: string[] = [];
  if (nonEmpty(data.meetingGoal)) goalLines.push(`Цель встречи: ${clean(data.meetingGoal)}`);
  if (ladder) {
    if (nonEmpty(ladder.max)) goalLines.push(`Максимум: ${clean(ladder.max)}`);
    if (nonEmpty(ladder.target)) goalLines.push(`Цель: ${clean(ladder.target)}`);
    if (nonEmpty(ladder.min)) goalLines.push(`Минимум: ${clean(ladder.min)}`);
  }
  if (nonEmpty(data.mainThesis)) goalLines.push(`Главный тезис: ${clean(data.mainThesis)}`);
  if (nonEmpty(data.proposal)) goalLines.push(`Что предлагаем: ${clean(data.proposal)}`);
  const leave = data.leaveAfter || data.artifact;
  if (nonEmpty(leave)) goalLines.push(`Что оставляем: ${clean(leave)}`);
  pushSection(sections, "Цель встречи и лестница запросов", [paragraphs(goalLines)]);

  // 2. Портрет ведомства и повестки
  const portrait: MinistryPortrait | undefined = data.ministryPortrait;
  if (portrait) {
    const blocks: (DocBlock | null)[] = [];
    const bw = portrait.budgetWindow;
    if (bw && (nonEmpty(bw.signal) || nonEmpty(bw.tension) || nonEmpty(bw.decision))) {
      blocks.push(
        paragraphs([
          nonEmpty(bw.signal) ? `Сигнал: ${clean(bw.signal)}` : "",
          nonEmpty(bw.tension) ? `Напряжение: ${clean(bw.tension)}` : "",
          nonEmpty(bw.decision) ? `Вывод для встречи: ${clean(bw.decision)}` : "",
        ]),
      );
      const bwSources = (bw.sources ?? []).map(sourceRef).filter(Boolean);
      if (bwSources.length) {
        blocks.push({ kind: "paragraphs", lines: ["Источники бюджетного окна:"] });
        blocks.push(paragraphs(bwSources, true));
      }
    }
    const stats = (portrait.stats ?? []).filter((s) => nonEmpty(s.value) || nonEmpty(s.label));
    if (stats.length) {
      blocks.push(
        table(
          ["Показатель", "Значение", "Что это значит", "Источник"],
          stats.map((s) => [
            withTier(s.label, s.tier),
            clean(s.value),
            clean(s.caption),
            sourceRef(s.source),
          ]),
        ),
      );
    }
    const initiatives = (portrait.initiatives ?? []).filter((i) => nonEmpty(i.title));
    if (initiatives.length) {
      blocks.push({ kind: "paragraphs", lines: ["Что ведомство уже делает (зацепки):"] });
      blocks.push(
        paragraphs(
          initiatives.map((i) =>
            withTier(nonEmpty(i.detail) ? `${clean(i.title)} — ${clean(i.detail)}` : clean(i.title), i.tier),
          ),
          true,
        ),
      );
    }
    const incumbents = (portrait.incumbents ?? []).filter((i) => nonEmpty(i.title));
    if (incumbents.length) {
      blocks.push({ kind: "paragraphs", lines: ["Что уже внедрено (конкуренты / точки интеграции):"] });
      blocks.push(
        paragraphs(
          incumbents.map((i) =>
            withTier(nonEmpty(i.detail) ? `${clean(i.title)} — ${clean(i.detail)}` : clean(i.title), i.tier),
          ),
          true,
        ),
      );
    }
    pushSection(sections, "Портрет ведомства и повестки", blocks, "Ядро — факты из открытых источников");
  }

  // 3. Досье ЛПР
  const dossier: LprDossier | undefined = data.lprDossier;
  if (dossier) {
    const header: string[] = [];
    if (nonEmpty(dossier.name)) header.push(`ЛПР: ${clean(dossier.name)}`);
    if (nonEmpty(dossier.role)) header.push(clean(dossier.role));
    const tiles: { label: string; tile?: LprTile }[] = [
      { label: "Известно", tile: dossier.known },
      { label: "Мотив / зона решений", tile: dossier.motive },
      { label: "Отношение к Сберу", tile: dossier.relationship },
      { label: "Добрать на встрече", tile: dossier.ask },
    ];
    const rows = tiles
      .filter((t) => t.tile && nonEmpty(t.tile.text))
      .map((t) => [
        t.label,
        withTier((t.tile as LprTile).text, (t.tile as LprTile).tier),
        sourceRef((t.tile as LprTile).source),
      ]);
    pushSection(sections, "Досье ЛПР", [
      paragraphs(header),
      table(["Аспект", "Содержание", "Источник"], rows),
    ]);
  }

  // 4. Карта участников
  const participants = (data.participants ?? []).filter(
    (p: MeetingParticipant) => nonEmpty(p.role) && nonEmpty(p.whatMatters),
  );
  if (participants.length) {
    const stanceLabel: Record<MeetingParticipant["stance"], string> = {
      ally: "союзник",
      skeptic: "скептик",
      neutral: "нейтрал",
    };
    pushSection(sections, "Карта участников встречи", [
      table(
        ["Участник", "Отношение", "Что важно / как работать"],
        participants.map((p) => [
          withTier(nonEmpty(p.name) ? `${clean(p.name)} · ${clean(p.role)}` : clean(p.role), p.tier),
          stanceLabel[p.stance] ?? "нейтрал",
          clean(p.whatMatters),
        ]),
      ),
    ]);
  }

  // 5. Тезисы под повестку ЛПР
  const theses = (data.theses ?? []).filter((t) => nonEmpty(t.text));
  if (theses.length) {
    pushSection(
      sections,
      "Тезисы под повестку ЛПР",
      [
        table(
          ["Тезис", "Привязан к", "Доказательная база"],
          theses.map((t) => [withTier(t.text, t.tier), clean(t.tiedTo), clean(t.evidence)]),
        ),
      ],
      "Каждый тезис привязан к конкретному факту",
    );
  }

  // 6. Участие Сбера
  pushSection(sections, "Участие Сбера", [sberActionsBlocks(data.sberActions)]);

  // 7. Сценарий встречи
  const agenda = (data.agenda ?? []).filter((b) => nonEmpty(b.topic) || nonEmpty(b.sberSays));
  if (agenda.length) {
    pushSection(sections, "Сценарий встречи", [
      table(
        ["Время", "Тема", "Сбер говорит", "Спрашиваем ЛПР", "Фиксируем"],
        agenda.map((b) => [
          clean(b.time),
          clean(b.topic),
          clean(b.sberSays),
          clean(b.askLpr),
          clean(b.fixDecision),
        ]),
      ),
    ]);
  }

  // 8. Возражения
  const objections = (data.objections ?? []).filter((o: Objection) => nonEmpty(o.objection));
  if (objections.length) {
    pushSection(
      sections,
      "Возражения и как снимать",
      [
        table(
          ["Возражение", "Истинная причина", "Ответ", "Нужный факт", "Запасной ход"],
          objections.map((o) => [
            withTier(`«${clean(o.objection)}»${o.specific ? " (специфично ЛПР)" : ""}`, o.tier),
            clean(o.trueReason),
            clean(o.response),
            clean(o.factNeeded),
            clean(o.fallback),
          ]),
        ),
      ],
    );
  }

  // 9. После встречи
  const after = data.afterMeeting;
  const outcomes: { title: string; outcome?: MeetingOutcome; steps: NextStep[] }[] = [
    { title: "Если согласились", outcome: after?.outcomes?.ifYes, steps: after?.outcomes?.ifYes?.steps ?? data.ifYes ?? [] },
    { title: "Если взяли паузу", outcome: after?.outcomes?.ifPause, steps: after?.outcomes?.ifPause?.steps ?? data.ifPause ?? [] },
    { title: "Если отказали", outcome: after?.outcomes?.ifNo, steps: after?.outcomes?.ifNo?.steps ?? data.ifNo ?? [] },
  ];
  const afterBlocks: (DocBlock | null)[] = [];
  for (const o of outcomes) {
    const steps = nextStepLines(o.steps);
    const trigger = clean(o.outcome?.triggerSignal);
    const capture = clean(o.outcome?.whatToCapture);
    if (!steps.length && !trigger && !capture) continue;
    afterBlocks.push({ kind: "paragraphs", lines: [`${o.title}:`] });
    const detail: string[] = [];
    if (trigger) detail.push(`Как понять: ${trigger}`);
    if (capture) detail.push(`Зафиксировать: ${capture}`);
    if (detail.length) afterBlocks.push(paragraphs(detail));
    if (steps.length) afterBlocks.push({ kind: "paragraphs", lines: steps, bullet: true });
  }
  const first48h = nextStepLines(after?.first48h);
  if (first48h.length) {
    afterBlocks.push({ kind: "paragraphs", lines: ["Первые 48 часов:"] });
    afterBlocks.push({ kind: "paragraphs", lines: first48h, bullet: true });
  }
  pushSection(sections, "После встречи", afterBlocks);

  // 10. Источники
  const src = sourcesSection(data.sources, data.hypotheses);
  if (src) sections.push(src);

  return sections;
}

// ── brief ────────────────────────────────────────────────────────────────

function buildBriefSections(data: BriefOutput): DocSection[] {
  const sections: DocSection[] = [];

  pushSection(sections, "Решение", [paragraphs([data.decision])]);
  pushSection(sections, "Участие Сбера", [sberActionsBlocks(data.sberActions)]);
  pushSection(sections, "Доказательная база", [paragraphs(data.evidence, true)]);
  pushSection(sections, "Экономика", [paragraphs([data.economics])]);

  const riskRows = (data.risks ?? [])
    .filter((r) => nonEmpty(r.title))
    .map((r) => [
      clean(r.title),
      r.impact === "high" ? "высокое" : r.impact === "low" ? "низкое" : "среднее",
      clean(r.mitigation),
      clean(r.owner),
    ]);
  pushSection(sections, "Риски", [table(["Риск", "Влияние", "Как снять", "Ответственный"], riskRows)]);

  if (data.nextStep && nonEmpty(data.nextStep.action)) {
    pushSection(sections, "Следующий шаг", [paragraphs(nextStepLines([data.nextStep]))]);
  }

  const src = sourcesSection(data.sources);
  if (src) sections.push(src);

  return sections;
}

// ── strategy ────────────────────────────────────────────────────────────────

function buildStrategySections(data: StructuredOutput): DocSection[] {
  const sections: DocSection[] = [];

  // Решение
  const decisionLines: string[] = [];
  if (nonEmpty(data.decision)) decisionLines.push(clean(data.decision));
  if (nonEmpty(data.whyNow)) decisionLines.push(`Почему сейчас: ${clean(data.whyNow)}`);
  if (nonEmpty(data.costOfInaction)) decisionLines.push(`Цена бездействия: ${clean(data.costOfInaction)}`);
  if (nonEmpty(data.sberRole)) decisionLines.push(`Роль Сбера: ${clean(data.sberRole)}`);
  if (data.verdict) {
    const rec =
      data.verdict.recommendation === "go"
        ? "Рекомендуем"
        : data.verdict.recommendation === "no-go"
          ? "Не рекомендуем"
          : "Условно рекомендуем";
    const conf =
      data.verdict.confidence === "high" ? "высокая" : data.verdict.confidence === "low" ? "низкая" : "средняя";
    decisionLines.push(`Вердикт: ${rec} (уверенность ${conf})`);
    if (nonEmpty(data.verdict.oneLineWhy)) decisionLines.push(clean(data.verdict.oneLineWhy));
    if (nonEmpty(data.verdict.topCondition)) decisionLines.push(`Ключевое условие: ${clean(data.verdict.topCondition)}`);
  }
  pushSection(sections, "Решение", [paragraphs(decisionLines)]);

  // Экономика
  if (data.economics) {
    const e = data.economics;
    pushSection(sections, "Экономика", [
      paragraphs([
        nonEmpty(e.capex) ? `CAPEX: ${clean(e.capex)}` : "",
        nonEmpty(e.opex) ? `OPEX: ${clean(e.opex)}` : "",
        nonEmpty(e.expectedEffect) ? `Ожидаемый эффект: ${clean(e.expectedEffect)}` : "",
        nonEmpty(e.payback) ? `Окупаемость: ${clean(e.payback)}` : "",
        nonEmpty(e.horizon) ? `Горизонт: ${clean(e.horizon)}` : "",
        nonEmpty(e.note) ? `Оговорка: ${clean(e.note)}` : "",
      ]),
    ]);
  }

  // Ставки
  const bets = (data.bets ?? []).filter((b: StrategyBet) => nonEmpty(b.title));
  if (bets.length) {
    pushSection(sections, "Стратегические ставки", [
      table(
        ["Ставка", "Логика", "Продукт Сбера", "Первые 2 недели", "Критерий go/no-go", "Что проверить"],
        bets.map((b) => [
          `${clean(b.title)}${b.recommended ? " (рекомендуемая)" : ""}`,
          clean(b.logic),
          clean(b.sberProduct),
          clean(b.sberAction2weeks),
          clean(b.goNoGo),
          clean(b.checkNeeded),
        ]),
      ),
    ]);
  }

  // Участие Сбера
  pushSection(sections, "Участие Сбера", [sberActionsBlocks(data.sberActions)]);

  // План
  const plan = (data.plan ?? []).filter((p) => nonEmpty(p.action));
  if (plan.length) {
    pushSection(sections, "Дорожная карта", [
      table(
        ["Срок", "Действие", "Ответственный", "Результат", "Критерий завершения"],
        plan.map((p) => [clean(p.week), clean(p.action), clean(p.owner), clean(p.deliverable), clean(p.doneWhen)]),
      ),
    ]);
  }

  // Метрики
  const metrics = (data.metrics ?? []).filter((m) => nonEmpty(m.name));
  if (metrics.length) {
    pushSection(sections, "Метрики", [
      table(
        ["Метрика", "Формула", "Источник", "База", "Цель"],
        metrics.map((m) => [clean(m.name), clean(m.formula), clean(m.source), clean(m.baseline), clean(m.target)]),
      ),
    ]);
  }

  // Риски
  const riskRows = (data.risks ?? [])
    .filter((r) => nonEmpty(r.title))
    .map((r) => [
      clean(r.title),
      r.impact === "high" ? "высокое" : r.impact === "low" ? "низкое" : "среднее",
      clean(r.mitigation),
      clean(r.owner),
    ]);
  pushSection(sections, "Риски", [table(["Риск", "Влияние", "Как снять", "Ответственный"], riskRows)]);

  // Следующие шаги
  pushSection(sections, "Следующие шаги", [
    { kind: "paragraphs", lines: nextStepLines(data.nextSteps), bullet: true },
  ]);

  // Источники
  const src = sourcesSection(data.sources, data.hypotheses);
  if (src) sections.push(src);

  return sections;
}

// ── Диспетчер ────────────────────────────────────────────────────────────────

/** true, если для этого TypedOutput есть обобщённый рендер (всё, кроме region). */
export function supportsStructuredDoc(output: TypedOutput | null): output is
  | { kind: "meeting"; data: MeetingOutput }
  | { kind: "brief"; data: BriefOutput }
  | { kind: "strategy"; data: StructuredOutput } {
  return output?.kind === "meeting" || output?.kind === "brief" || output?.kind === "strategy";
}

export function buildDocModel(output: TypedOutput, title: string, meta: string[] = []): DocModel | null {
  const subtitle = meta.filter(Boolean).join(" · ") || undefined;
  if (output.kind === "meeting") {
    return { title, subtitle, sections: buildMeetingSections(output.data) };
  }
  if (output.kind === "brief") {
    return { title, subtitle, sections: buildBriefSections(output.data) };
  }
  if (output.kind === "strategy") {
    return { title, subtitle, sections: buildStrategySections(output.data) };
  }
  return null;
}

/** Заголовок документа по типу вывода (регион обрабатывается отдельно). */
export function docTitleFor(output: TypedOutput, fallback: string): string {
  if (output.kind === "meeting") return clean(output.data.meetingGoal) || fallback;
  if (output.kind === "brief") return clean(output.data.decision).slice(0, 120) || fallback;
  if (output.kind === "strategy") return clean(output.data.decision).slice(0, 120) || fallback;
  return fallback;
}
