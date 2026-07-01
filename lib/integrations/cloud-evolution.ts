import { z } from "zod";
import { callLLM } from "@/lib/agents/llm-client";
import { evolutionResultSchema, type EvolutionResult } from "@/lib/schemas/playbook";
import { createId } from "@/lib/utils/ids";
import { nowIso } from "@/lib/utils/dates";
import type { OuroborosEvolutionInput } from "./ouroboros-client";

function extractJson(text: string): string {
  // Убираем markdown fences если есть
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Не удалось найти JSON в ответе LLM. Начало: ${candidate.slice(0, 100)}`);
  }
  return candidate.slice(start, end + 1);
}

const fastEvolutionSchema = z.object({
  problem: z.string(),
  improvement: z.string(),
  newRule: z.string(),
  playbookName: z.string().optional().default("Стратегический режим"),
  playbookUpdate: z.string().optional().default(""),
  summary: z.string(),
  changed: z.preprocess(coerceStringList, z.array(z.string()).default([])),
  sberHelp: z.preprocess(coerceStringList, z.array(z.string()).default([])),
  sourceChecks: z.preprocess(coerceStringList, z.array(z.string()).default([])),
  nextSteps: z.preprocess(coerceStringList, z.array(z.string()).default([])),
});

function coerceStringList(value: unknown) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    return value
      .split(/\n|;|•|-/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (value == null) return [];
  return [String(value)];
}

function sanitizeUnsupportedClaims(text: string) {
  return text
    .replace(/Executive decision memo/gi, "Управленческая записка")
    .replace(/Executive memo/gi, "управленческая записка")
    .replace(/Go\/No-Go/gi, "критерий запуска или остановки")
    .replace(/Go-остановка/gi, "критерий запуска или остановки")
    .replace(/\bNo-Go\b/gi, "остановка")
    .replace(/\bBaseline\b/gi, "базовая линия")
    .replace(/baseline нужно снять/gi, "нужно снять базовую линию")
    .replace(/SLA\s+baseline/gi, "SLA: базовую линию нужно снять")
    .replace(/SLA\s+базовая линия нужно снять/gi, "SLA: нужно снять базовую линию")
    .replace(/Снятие базовая линия/gi, "снятие базовой линии")
    .replace(/сокращени[ея]\s+штат[а-я\s]*(?:на\s*)?\d{1,3}(?:[-–]\d{1,3})?\s*%/gi, "снижение ручной нагрузки с перераспределением сотрудников на контроль исключений")
    .replace(/сокращени[ея]\s+штат[а-я\s]*/gi, "снижение ручной нагрузки ")
    .replace(/SLA\s*[><=]\s*(?:\d{1,3}\s*%|проверяемая гипотеза эффекта)/gi, "SLA baseline нужно снять")
    .replace(/\b\d{1,3}(?:[-–]\d{1,3})?\s*%/g, "baseline нужно снять")
    .replace(/\bNPS\b/gi, "индекс удовлетворенности")
    .replace(/долгосроя/gi, "долгового управления")
    .replace(/чат-боты и классификаторы обращений/gi, "классификация и маршрутизация обращений")
    .replace(/автоматического маршрутизации/gi, "автоматической маршрутизации")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function executiveRisks(items: string[]) {
  const filtered = items
    .map(sanitizeUnsupportedClaims)
    .filter((item) => !/^(?:#+\s*)?(Стратегическая ставка|Решение|Закупки|Обращения):/i.test(item))
    .filter((item) => item.length > 20)
    .slice(0, 4);

  return filtered.length
    ? filtered
    : [
        "Нет доступа к данным казначейства, закупок и обращений в сопоставимом формате.",
        "Не согласован владелец результата со стороны Минфина, Казначейства и цифрового блока региона.",
        "Экономический эффект не подтвержден базовой линией до старта пилота.",
        "Пилот уходит в техническую демонстрацию без управленческого решения о масштабировании.",
      ];
}

function executiveNextSteps(items: string[]) {
  const filtered = items
    .flatMap((item) => item.split(/\n+\s*-\s*/))
    .map(sanitizeUnsupportedClaims)
    .filter((item) => !/JSON|дубликат|англоязыч|метадан|массив|sections|проверить отсутствие/i.test(item))
    .slice(0, 3);

  return filtered.length
    ? filtered
    : [
        "Согласовать пилотный муниципалитет и владельца результата.",
        "За 5 рабочих дней снять базовую линию: стоимость процесса, сроки обработки, объем ручных операций и качество решения обращений.",
        "Назначить встречу с Минфином, Казначейством и цифровым блоком региона для решения о запуске пилота.",
      ];
}

function publicChangeLog(items: string[], fallback: string) {
  const filtered = items
    .map(sanitizeUnsupportedClaims)
    .filter((item) => !/JSON|дубликат|англоязыч|метадан|массив|sections|проверить отсутствие/i.test(item))
    .slice(0, 5);

  return filtered.length
    ? filtered
    : [
        sanitizeUnsupportedClaims(fallback),
        "Следующие шаги переведены из технических проверок в управленческие действия.",
        "Спорные метрики оставлены как гипотезы до снятия базовой линии.",
      ];
}

export async function callCloudEvolution(input: OuroborosEvolutionInput): Promise<EvolutionResult> {
  const activePlaybookNames = input.activePlaybooks.map((item) => item.name).join(", ");
  // Полярность: высокая оценка → закрепляем удачный приём, низкая → исправляем ошибку.
  const isPositive = input.feedback.rating >= 4;
  const ruleGuidance = isPositive
    ? [
        "Оценка высокая: сессия удачная. newRule должен ЗАКРЕПИТЬ удачный приём — что именно сработало и что повторять в похожих сессиях. Сформулируй как позитивное правило ('Всегда...', 'Делай...').",
        "summary и changed опиши как усиление подхода, а не как исправление ошибок.",
      ]
    : [
        "Оценка низкая: материал требует доработки. newRule должен быть применим к будущим похожим сессиям: что НЕ делать и чем заменить.",
        "Если feedback ругает связь со Сбером, newRule обязан требовать формат: актив Сбера → первые 2 недели → данные → артефакт → коммерческий следующий шаг.",
        "Если feedback ругает поверхностность, newRule обязан требовать сравнение 3-4 опций, а не одну платформу/пилот.",
      ];
  const raw = await callLLM({
    temperature: 0.15,
    maxTokens: 3000,
    messages: [
      {
        role: "system",
        content: "Ты — Evolution Runtime. Отвечай ТОЛЬКО валидным JSON. Первый символ — {, последний — }. Никакого текста вне JSON.",
      },
      {
        role: "user",
        content: [
          isPositive
            ? "Сессия получила высокую оценку. Извлеки из неё удачный приём в виде правила playbook и верни JSON:"
            : "Улучши правило playbook на основе feedback. Верни JSON:",
          `{"problem":"...","improvement":"...","newRule":"одно правило до 120 символов","playbookName":"${activePlaybookNames || "Стратегический режим"}","playbookUpdate":"...","summary":"улучшенное резюме до 600 знаков","changed":["...","..."],"sberHelp":["актив Сбера","первые 2 недели","данные","артефакт"],"sourceChecks":["...","..."],"nextSteps":["...","...","..."]}`,
          ...ruleGuidance,
          "",
          `Роль: ${input.sessionProfile.userRole}, тип: ${input.sessionProfile.taskType}, тема: "${input.sessionProfile.focusTopic?.slice(0, 80)}"`,
          `Feedback: оценка ${input.feedback.rating}/5. Теги: ${input.feedback.tags.join(", ") || "нет"}. Комментарий: "${input.feedback.comment.slice(0, 300)}"`,
          `Текущий summary: "${input.output.summary?.slice(0, 200)}"`,
        ].join("\n"),
      },
    ],
  });

  const patch = parseEvolutionPatch(raw, input);
  const createdAt = nowIso();
  const changed = publicChangeLog(patch.changed.length ? patch.changed : [patch.improvement], patch.improvement);
  const sberHelp = patch.sberHelp.length && !isGenericSberHelp(patch.sberHelp)
    ? patch.sberHelp
    : domainSpecificSberHelp(input);
  const sourceChecks = patch.sourceChecks.length
    ? patch.sourceChecks
    : ["Подтвердить фактический объем обращений, текущие SLA, бюджет процесса и нормативные ограничения на данных региона."];

  const rewrittenAnswer = {
    ...input.output,
    id: createId("out"),
    sessionId: input.sessionProfile.id,
    type: input.sessionProfile.taskType,
    title: input.output.title,
    summary: sanitizeUnsupportedClaims(patch.summary),
    // Сохраняем оригинальные секции, только обновляем summary и добавляем блок Сбера
    sections: [
      // Оригинальные секции — убираем мусорные и дублирующие
      ...input.output.sections
        .filter((s) => !["Управленческое решение", "Что изменено по фидбеку", "Как Сбер может помочь", "Что нужно проверить источниками"].includes(s.title))
        .map((s) => ({
          ...s,
          id: createId("sec"),
          title: sanitizeUnsupportedClaims(s.title),
          content: sanitizeUnsupportedClaims(s.content),
        })),
      // Блок Сбера — добавляем/обновляем
      {
        id: createId("sec"),
        title: "Как Сбер может помочь",
        content: sberHelp.map((item) => `- ${sanitizeUnsupportedClaims(item)}`).join("\n"),
        type: "actions" as const,
      },
      // Что проверить
      {
        id: createId("sec"),
        title: "Что нужно проверить источниками",
        content: sourceChecks.map((item) => `- ${sanitizeUnsupportedClaims(item)}`).join("\n"),
        type: "text" as const,
      },
    ],
    recommendations: changed.map(sanitizeUnsupportedClaims).slice(0, 5),
    risks: executiveRisks(input.output.risks),
    nextSteps: executiveNextSteps(patch.nextSteps.length ? patch.nextSteps : input.output.nextSteps),
    markdown: [
      `## Резюме\n\n${sanitizeUnsupportedClaims(patch.summary)}`,
      ...input.output.sections
        .filter((s) => !["Управленческое решение", "Что изменено по фидбеку"].includes(s.title))
        .map((s) => `## ${sanitizeUnsupportedClaims(s.title)}\n\n${sanitizeUnsupportedClaims(s.content)}`),
      `## Как Сбер может помочь\n\n${sberHelp.map((item) => `- ${sanitizeUnsupportedClaims(item)}`).join("\n")}`,
      `## Что нужно проверить источниками\n\n${sourceChecks.map((item) => `- ${sanitizeUnsupportedClaims(item)}`).join("\n")}`,
    ].join("\n\n"),
    createdAt,
    sources: [
      ...(input.output.sources ?? []).map((source) => ({
        ...source,
        title: sanitizeUnsupportedClaims(source.title),
        excerpt: sanitizeUnsupportedClaims(source.excerpt),
      })),
      {
        title: "Feedback пользователя",
        type: "session_input" as const,
        excerpt: sanitizeUnsupportedClaims(input.feedback.comment || input.feedback.tags.join(", ")),
        status: "used" as const,
      },
    ],
  };

  return evolutionResultSchema.parse({
    problem: patch.problem,
    improvement: patch.improvement,
    newRule: patch.newRule,
    playbookName: patch.playbookName,
    playbookUpdate: patch.playbookUpdate,
    rewrittenAnswer,
  });
}

function isGenericSberHelp(items: string[]) {
  const text = items.join(" ").toLowerCase();
  return (
    /снять базов|собрать финансов|демонстрационн|управляющ/.test(text) &&
    !/павод|страх|уведом|мфц|семь|выплат|нмцк|поставщик|университет|работодател|колледж|зарплат|кадр/.test(text)
  );
}

function parseEvolutionPatch(raw: string, input: OuroborosEvolutionInput) {
  try {
    const extracted = extractJson(raw);
    console.log(`[evolution] extracted JSON (first 200): ${extracted.slice(0, 200)}`);
    const parsed = fastEvolutionSchema.parse(JSON.parse(extracted));
    console.log(`[evolution] parsed OK: improvement="${parsed.improvement.slice(0, 80)}"`);
    return parsed;
  } catch (err) {
    console.warn(`[evolution] parse failed: ${err instanceof Error ? err.message : err}`);
    console.warn(`[evolution] raw (first 300): ${raw.slice(0, 300)}`);
    const focus = input.sessionProfile.focusTopic || input.output.title;
    return fastEvolutionSchema.parse({
      problem: "Модель вернула неструктурированный evolution-ответ; применен безопасный патч по пользовательскому фидбеку.",
      improvement: "Ответ переведен в практичный управленческий формат: не только ИИ, предметная роль Сбера, управленческие следующие шаги и проверяемые гипотезы.",
      newRule: "Для любой темы сначала сравни процессные, финансовые, партнерские, организационные и технологические решения; ИИ предлагай только как один из инструментов, если он уместен.",
      playbookName: input.activePlaybooks[0]?.name || "Стратегический режим",
      playbookUpdate: "Добавлено правило: не сводить стратегию к ИИ и раскрывать роль Сбера через конкретный актив, первые 2 недели, данные, интеграции, артефакт и владельца.",
      summary: [
        `Управленческая версия по теме: ${focus}.`,
        "Решение не должно сводиться к ИИ: сначала выбирается процессный, финансовый, партнерский или организационный рычаг, а технология поддерживает контур там, где дает проверяемый эффект.",
        "Роль Сбера: снять базовую линию, собрать финансовую модель, определить данные и каналы, подготовить демонстрационный контур и вынести решение на управляющий комитет.",
      ].join(" "),
      changed: [
        "Добавлен выбор между процессными, финансовыми, партнерскими, организационными и технологическими решениями.",
        "Блок Сбера переписан из общей формулировки в набор конкретных действий.",
        "Следующие шаги переведены в управленческий формат.",
      ],
      sberHelp: domainSpecificSberHelp(input),
      sourceChecks: [
        "Проверить нормативные ограничения и текущий регламент процесса.",
        "Снять базовую линию: объем, стоимость, время цикла, качество, риски и владельцы данных.",
        "Подтвердить открытыми источниками или внутренними данными все численные эффекты до встречи с руководителем.",
      ],
      nextSteps: [
        "Назначить владельца результата со стороны заказчика.",
        "За 5 рабочих дней снять базовую линию процесса и перечень доступных данных.",
        "Провести управляющую встречу: выбрать рычаг решения, пилотную зону и критерии запуска или остановки.",
      ],
    });
  }
}

function domainSpecificSberHelp(input: OuroborosEvolutionInput) {
  const topic = `${input.sessionProfile.focusTopic ?? ""} ${input.feedback.comment}`.toLowerCase();
  if (/павод|мчс|страхован|оповещ|жкх|штаб/.test(topic)) {
    return [
      "Актив Сбера: платежная инфраструктура, каналы массовых уведомлений, страховые и финансовые сервисы для жителей и муниципальных подрядчиков.",
      "Первые 2 недели: вместе со штабом описать сценарии паводка, карту критических объектов, каналы оповещения, реестр подрядчиков и платежные точки риска.",
      "Данные и интеграции: списки зон риска, обращения жителей, заявки ЖКХ, выплаты/компенсации, договоры подрядчиков, каналы СМС/push/личный кабинет.",
      "Артефакт для заказчика: штабная карта решений, регламент оповещения, финансовый контур выплат и страхования, критерии готовности муниципалитетов.",
    ];
  }
  if (/кадр|резерв|мотивац|занятост|зарплат/.test(topic)) {
    return [
      "Актив Сбера: зарплатные проекты, образовательные партнерства, карьерные сервисы, финансовые продукты для сотрудников и аналитика удержания.",
      "Первые 2 недели: снять карту вакансий, текучесть, причины отказов кандидатов, партнерства с колледжами и экономику мотивационных мер.",
      "Данные и интеграции: вакансии, кадровый резерв, обучение, зарплатные проекты, льготы, каналы привлечения и владелец кадровой программы.",
      "Артефакт для заказчика: модель кадрового резерва, пакет мотивационных мер, план партнерств с колледжами и критерии снижения дефицита.",
    ];
  }
  if (/университет|образован|работодател|корпоративн|внебюджет|колледж/.test(topic)) {
    return [
      "Актив Сбера: корпоративные заказчики, образовательные платформы, зарплатные проекты, аналитика спроса на компетенции и партнерский контур с работодателями.",
      "Первые 2 недели: собрать портфель работодателей, карту дефицитных компетенций, текущую воронку продаж программ и экономику одного корпоративного потока.",
      "Данные и интеграции: CRM университета, заявки работодателей, загрузка преподавателей, стоимость программы, зарплатные/карьерные сервисы и каналы привлечения слушателей.",
      "Артефакт для заказчика: продуктовая линейка программ, коммерческая модель, список якорных работодателей, план продаж и критерии запуска первых потоков.",
    ];
  }
  if (/соц|семь|мфц|выплат|пособ|граждан|уведомлен/.test(topic)) {
    return [
      "Актив Сбера: банковские каналы коммуникации, платежная экспертиза, идентификация клиента, уведомления и финансовые сервисы для семей.",
      "Первые 2 недели: описать путь семьи от права на выплату до получения услуги, точки отказа, каналы МФЦ/ведомства/банка и согласия на коммуникацию.",
      "Данные и интеграции: статусы выплат, события жизненной ситуации, контактные каналы, реестр льгот, платежные реквизиты и правовой контур обмена данными.",
      "Артефакт для заказчика: карта клиентского пути, модель проактивных уведомлений, перечень интеграций, план пилота на выбранной категории семей.",
    ];
  }
  if (/закуп|контракт|нмцк|поставщик|казнач/.test(topic)) {
    return [
      "Актив Сбера: экспертиза закупочных процедур, работа с поставщиками, финансовые сервисы для участников закупок и аналитика платежной дисциплины.",
      "Первые 2 недели: разобрать причины несостоявшихся закупок, качество ТЗ, расчет НМЦК, график контрактования и узкие места поставщиков.",
      "Данные и интеграции: план-график закупок, протоколы несостоявшихся процедур, НМЦК, казначейский график, база поставщиков и условия оплаты.",
      "Артефакт для заказчика: пакет типовых ТЗ, карта поставщиков, регламент ранней проверки НМЦК и управленческий дашборд риска срыва закупки.",
    ];
  }
  return [
    "Актив Сбера: платежные и цифровые каналы, экспертиза финансовой модели, интеграционный контур и опыт запуска сервисов для массовых пользователей или организаций.",
    "Первые 2 недели: совместно с владельцем заказчика снять базовую линию, описать процесс, данные, ограничения, каналы и критерии запуска или остановки.",
    "Данные и интеграции: реестр участников процесса, события/транзакции/заявки, каналы уведомлений, ответственный владелец данных и согласованный правовой контур.",
    "Артефакт для заказчика: карта решений, финансовая модель эффекта, план пилота, критерии приемки и материал на управляющий комитет.",
  ];
}
