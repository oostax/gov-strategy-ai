import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assessAgenda,
  assessMeetingOutput,
  assessSberActions,
  assessTypedOutput,
  deriveFiscalStance,
  hasSupportedFiscalStance,
  normalizeFactualProse,
  sanitizeNegotiationCommitments,
  stripDecorativeSymbols,
  stripUnsupportedHighRiskClauses,
  stripUnsupportedNamedParentheticals,
  stripUnsupportedNumericClauses,
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
