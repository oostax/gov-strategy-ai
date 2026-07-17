import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assessAgenda,
  assessMeetingOutput,
  assessSberActions,
  assessTypedOutput,
  cleanSourceText,
  deriveFiscalStance,
  hasSupportedFiscalStance,
  normalizeFactualProse,
  sanitizeNegotiationCommitments,
  stripDecorativeSymbols,
  stripUnsupportedHighRiskClauses,
  stripUnsupportedNamedParentheticals,
  stripUnsupportedNumericClauses,
  stripUnsupportedRiskNumberTokens,
} from "../../lib/quality/meeting-output-quality.ts";
import {
  canUseAsCrmFact,
  canUseAsHistoricalUserInput,
  classifyMemorySource,
} from "../../lib/quality/memory-provenance.ts";

async function fixture(name) {
  const raw = await readFile(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
  return JSON.parse(raw);
}

test("полный материал встречи проходит quality gate", async () => {
  const output = await fixture("meeting-complete.json");
  const report = assessMeetingOutput(output, { taskType: "meeting_preparation" });
  assert.equal(report.ready, true);
  assert.equal(report.score, 100);
  assert.equal(report.agenda.complete, 4);
  assert.equal(report.sberActions.complete, 2);
});

test("заполненные только темами строки сценария не считаются готовыми", async () => {
  const output = await fixture("meeting-incomplete.json");
  const report = assessMeetingOutput(output, { taskType: "meeting_preparation" });
  assert.equal(report.ready, false);
  assert.equal(report.agenda.complete, 0);
  assert.equal(report.sberActions.complete, 0);
  assert.ok(report.issues.some((issue) => issue.code === "meeting.agenda.incomplete"));
  assert.ok(report.issues.some((issue) => issue.code === "meeting.sberActions.incomplete"));
});

test("agenda и sberActions требуют все обязательные поля", () => {
  assert.equal(assessAgenda([{ time: "0-3", topic: "Вход" }]).ready, false);
  assert.equal(assessSberActions([{ asset: "GigaChat" }]).ready, false);
});

test("неподтверждённый год удаляется из factual tile", () => {
  const text = "Назначен министром в 2022 году; представил программу 2026-2030 годов с бюджетом 5 млрд ₽.";
  const evidence = "Программа 2026-2030 годов. Объём финансирования составит 5 млрд ₽.";
  const result = stripUnsupportedNumericClauses(text, evidence);
  assert.equal(result.includes("2022"), false);
  assert.equal(result.includes("5 млрд"), true);
});

test("бюджетная позиция требует прямого подтверждения", () => {
  assert.equal(hasSupportedFiscalStance("Регион имеет профицитный бюджет", "Общие сведения о бюджете"), false);
  assert.equal(hasSupportedFiscalStance("Дефицит бюджета 13,8 млрд ₽", "Дефицит бюджета 13,8 млрд ₽"), true);
  assert.deepEqual(deriveFiscalStance(552.2, 566), { kind: "deficit", delta: 13.8 });
  assert.deepEqual(deriveFiscalStance(538.1, 533.6), { kind: "surplus", delta: 4.5 });
});

test("деловой текст очищается от декоративных эмодзи", () => {
  assert.equal(stripDecorativeSymbols("1️⃣ GigaChat → 2️⃣ SberCloud"), "GigaChat → SberCloud");
});

test("оффер не назначает пилотную зону и куратора за заказчика", () => {
  const result = sanitizeNegotiationCommitments(
    "Запускаем пилот в одном муниципалитете – Казани, без дополнительных капитальных вложений. Куратором назначаем заместителя Премьер-министра.",
  );
  assert.equal(result.includes("Казани"), false);
  assert.equal(result.includes("без дополнительных"), false);
  assert.equal(result.includes("Куратора проекта определяет заказчик"), true);
});

test("фактический текст не сохраняет неподтверждённое имя и обрывки", () => {
  const cleaned = stripUnsupportedNamedParentheticals(
    "Назначен 25 сентября 2025 г. (указ подписал Раустам Минниханов). занимал должность первого заместителя. в Казани.",
    "Назначен 25 сентября 2025 г. С апреля 2020 года занимал должность первого заместителя.",
  );
  assert.equal(
    normalizeFactualProse(cleaned),
    "Назначен 25 сентября 2025 г. Занимал должность первого заместителя.",
  );
});

test("неподтверждённый процент не попадает в главный тезис", () => {
  const result = stripUnsupportedHighRiskClauses(
    "Пилот сократит время обработки. Экономия составит 20% бюджета.",
    "Официальный источник подтверждает запуск программы, но не экономию.",
  );
  assert.equal(result, "Пилот сократит время обработки.");
});

test("сгенерированный вывод и feedback не становятся CRM-контекстом", () => {
  assert.equal(classifyMemorySource("gov-strategy-ai/session"), "user_input");
  assert.equal(canUseAsHistoricalUserInput("gov-strategy-ai/session"), true);
  assert.equal(canUseAsHistoricalUserInput("gov-strategy-ai/agent_output"), false);
  assert.equal(canUseAsHistoricalUserInput("gov-strategy-ai/decision_feedback"), false);
  assert.equal(canUseAsCrmFact("gov-strategy-ai/session"), false);
});

test("quality gate блокирует brief без доказательств и источников", () => {
  const report = assessTypedOutput({
    kind: "brief",
    data: {
      decision: "Запустить пилот",
      economics: "Эффект требует baseline",
      evidence: ["Факт не найден"],
      sources: [],
      nextStep: { action: "Запросить данные", owner: "Руководитель", deadline: "2026-07-20" },
    },
  });
  assert.equal(report.ready, false);
  assert.ok(report.issues.some((issue) => issue.code === "brief.evidence.short"));
  assert.ok(report.issues.some((issue) => issue.code === "brief.sources.short"));
});

// ── Дефект 1: HTML-entities и wiki-разметка в названиях источников ─────────

test("cleanSourceText декодирует числовые hex HTML-сущности", () => {
  assert.equal(cleanSourceText("&#x417;&#x430;"), "За");
});

test("cleanSourceText декодирует двойное кодирование (&amp;#x417; → буква)", () => {
  // Первый проход снимает &amp; → &, оставляя &#x417;; второй проход
  // декодирует его в саму букву. Один проход дал бы обрыв на "&#x417;".
  assert.equal(cleanSourceText("&amp;#x417;"), "З");
});

test("cleanSourceText удаляет wiki-шаблон {{Wayback|...}} целиком", () => {
  assert.equal(cleanSourceText("{{Wayback|url=x}}"), "");
  assert.equal(cleanSourceText("Статья {{Wayback|url=x}} на сайте"), "Статья на сайте");
});

test("cleanSourceText превращает wiki-ссылку [[url|текст]] в видимый текст", () => {
  assert.equal(cleanSourceText("[[rbc.ru|РБК]]"), "РБК");
});

test("cleanSourceText декодирует полное название закона из hex-сущностей", () => {
  const raw =
    "&#x417;&#x430;&#x43A;&#x43E;&#x43D; &#x420;&#x435;&#x441;&#x43F;&#x443;&#x431;&#x43B;&#x438;&#x43A;&#x438; " +
    "&#x422;&#x430;&#x442;&#x430;&#x440;&#x441;&#x442;&#x430;&#x43D;";
  assert.equal(cleanSourceText(raw), "Закон Республики Татарстан");
});

test("cleanSourceText не трогает нормальную краткую ссылку [домен]", () => {
  assert.equal(cleanSourceText("[rbc.ru]"), "[rbc.ru]");
});

test("cleanSourceText удаляет тег <ref>...</ref>", () => {
  assert.equal(cleanSourceText("<ref>служебная сноска</ref>Заголовок статьи"), "Заголовок статьи");
});

// ── Дефект 2: negotiation-guard/числовой скруббер вне proposal ──────────────

test("самоназначенный куратор убирается из строки-гипотезы (глагол «будет»)", () => {
  // До фикса sanitizeNegotiationCommitments ловил только «куратором назначаем»;
  // модель также формулирует это как «куратором будет X» — обе формы переговорной
  // позиции заказчика должны нейтрализоваться одинаково.
  const hypothesis = "Куратором будет заместитель Премьер-министра, это ускорит согласование.";
  const result = sanitizeNegotiationCommitments(hypothesis);
  assert.equal(result.includes("Куратором будет"), false);
  assert.equal(result.includes("заместитель Премьер-министра"), false);
  assert.equal(result.includes("Куратора проекта определяет заказчик"), true);
});

test("неподтверждённый процент убирается из поля sberActions без опустошения поля", () => {
  const evidence = "Официальный источник подтверждает запуск программы цифровизации региона.";
  const field = "Обеспечить охват минимум 15% населения региона в первые две недели.";
  // Клаузное удаление (высокий уровень строгости): вся клауза с процентом не
  // подтверждена evidence и должна быть удалена целиком, как для mainThesis/proposal.
  const afterClauses = stripUnsupportedHighRiskClauses(field, evidence);
  assert.equal(afterClauses.includes("15%"), false);
  assert.equal(afterClauses.includes("минимум"), false);
  // Точечный fallback (когда клаузное удаление опустошает всё поле) вырезает
  // только число+единицу, оставляя обязательное поле непустым.
  const afterTokens = stripUnsupportedRiskNumberTokens(field, evidence);
  assert.equal(afterTokens.includes("15%"), false);
  assert.ok(afterTokens.length > 0);
});

test("подтверждённый evidence масштаб («жителей») не вырезается", () => {
  const evidence = "Программа охватит 200 000 жителей региона в первый год работы.";
  const field = "Охват составит ≈200 000 жителей региона.";
  const result = stripUnsupportedHighRiskClauses(field, evidence);
  assert.equal(result.includes("200 000"), true);
});
