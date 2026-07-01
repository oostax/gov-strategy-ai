import type { ActionRequest } from "@/lib/schemas/agent";
import type { AgentOutput, OutputSection, OutputSource } from "@/lib/schemas/output";
import type { SessionProfile, TaskType } from "@/lib/schemas/session";
import { callLLM } from "./llm-client";
import { buildActionMessages, formatRegionContext, modePrompt, selectRelevantPlaybooks } from "./prompt-builder";
import { parseAgentOutput } from "./validators";
import { getStorage } from "@/lib/storage/local-json-storage";
import { getMemoryClient } from "@/lib/integrations/mempalace-client";
import { formatEvidenceForPrompt, retrieveOpenSources, type WebEvidence } from "@/lib/integrations/web-retrieval";
import { roleLabels, taskLabels } from "@/lib/schemas/session";
import { nowIso } from "@/lib/utils/dates";
import { createId } from "@/lib/utils/ids";

export type GenerationStep =
  | "storage"
  | "playbooks"
  | "region_context"
  | "memory_search"
  | "web_research"
  | "llm_summary"
  | "llm_directions"
  | "llm_mvp"
  | "llm_metrics"
  | "llm_risks"
  | "assemble"
  | "save_output"
  | "memory_write"
  | "done";

export async function generateStrategyOutput(
  session: SessionProfile,
  prompt = "",
  onStep?: (step: GenerationStep, message: string) => void | Promise<void>,
) {
  await onStep?.("storage", "Сессия загружена из хранилища");
  const storage = getStorage();
  await onStep?.("playbooks", "Подбираю релевантные правила");
  const playbooks = await storage.listPlaybooks();
  const activePlaybooks = selectRelevantPlaybooks(session, playbooks);
  await onStep?.(
    "region_context",
    session.taskType === "sber_region_strategy"
      ? "Читаю стратегию региона и портфель Сбера"
      : "Читаю региональный контекст",
  );
  const region = await resolveRegionForSession(session);
  await onStep?.("memory_search", "Ищу релевантную память в MemPalace");
  const memories = await getMemoryClient().search(`${session.focusTopic ?? ""} ${session.region ?? ""} ${prompt}`);
  await onStep?.("web_research", "Ищу открытые источники и факты");
  const webEvidence = await retrieveOpenSources({
    region: session.region,
    focusTopic: `${session.focusTopic ?? ""} ${prompt}`.trim(),
  });
  const context = [
    sessionContext(session, prompt),
    formatRegionContext(region, { includeSberPortfolio: session.taskType === "sber_region_strategy" }),
    `Активные правила:\n${activePlaybooks.map((item) => `## ${item.name}\n${item.rules.slice(0, 2).map((rule) => `- ${rule}`).join("\n")}`).join("\n\n")}`,
    `Память MemPalace:\n${memories.slice(0, 3).map((item) => `- ${item.title}: ${item.excerpt.slice(0, 280)}`).join("\n") || "релевантные записи отсутствуют"}`,
    `Открытые источники:\n${formatEvidenceForPrompt(webEvidence)}`,
  ].join("\n\n");

  const prompts = buildBlockPrompts(session);
  const model = process.env.CLOUD_RU_MODEL || "";
  const isReasoning = model.includes("gpt-oss") || model.includes("o1") || model.includes("o3");

  // Reasoning-модели нуждаются в большем бюджете токенов и последовательном выполнении
  const blockTokens = isReasoning ? 2500 : undefined; // undefined = use default from generateBlock

  let summary: string;
  let directions: string;
  let mvp: string;
  let metrics: string;
  let risksSber: string;

  if (isReasoning) {
    // Последовательно — reasoning-модели не справляются с 5 параллельными запросами
    await onStep?.("llm_summary", "Cloud.ru: управленческий вывод");
    summary = await generateBlock(session, context, prompts.summaryPrompt, blockTokens ?? 650);

    await onStep?.("llm_directions", "Cloud.ru: направления работ");
    directions = await generateBlock(session, context, prompts.directionsPrompt, blockTokens ?? 800);

    await onStep?.("llm_mvp", "Cloud.ru: план и пилот");
    mvp = await generateBlock(session, context, prompts.mvpPrompt, blockTokens ?? 600);

    await onStep?.("llm_metrics", "Cloud.ru: метрики и контроль");
    metrics = await generateBlock(session, context, prompts.metricsPrompt, blockTokens ?? 500);

    await onStep?.("llm_risks", "Cloud.ru: риски и роль Сбера");
    risksSber = await generateBlock(session, context, prompts.risksSberPrompt, blockTokens ?? 700);
  } else {
    // Параллельно — быстрые модели справляются
    await onStep?.("llm_summary", "Cloud.ru: управленческий вывод");
    const summaryP = generateBlock(session, context, prompts.summaryPrompt, 650);

    await onStep?.("llm_directions", "Cloud.ru: направления работ");
    const directionsP = generateBlock(session, context, prompts.directionsPrompt, 800);

    await onStep?.("llm_mvp", "Cloud.ru: план и пилот");
    const mvpP = generateBlock(session, context, prompts.mvpPrompt, 600);

    await onStep?.("llm_metrics", "Cloud.ru: метрики и контроль");
    const metricsP = generateBlock(session, context, prompts.metricsPrompt, 500);

    await onStep?.("llm_risks", "Cloud.ru: риски и роль Сбера");
    const risksSberP = generateBlock(session, context, prompts.risksSberPrompt, 700);

    [summary, directions, mvp, metrics, risksSber] = await Promise.all([summaryP, directionsP, mvpP, metricsP, risksSberP]);
  }

  await onStep?.("assemble", "Собираю финальный структурированный материал");
  const output = hardenOutput(assembleOutput(session, { summary, directions, mvp, metrics, risksSber }, activePlaybooks, memories, webEvidence));
  await onStep?.("save_output", "Сохраняю результат в хранилище сессии");
  await storage.saveOutput(output);
  await onStep?.("memory_write", "Записываю результат в MemPalace");
  await getMemoryClient().rememberOutput(output);
  await onStep?.("done", "Готово");
  return { output, activePlaybooks, memories };
}

function sessionContext(session: SessionProfile, prompt: string) {
  const horizonLabels: Record<string, string> = {
    "3_months": "3 месяца (оперативный горизонт)",
    "12_months": "12 месяцев (годовой горизонт)",
    "2028": "до 2028 года (среднесрочный горизонт)",
    "2030": "до 2030 года (долгосрочный горизонт)",
  };
  
  const detailLevelInstructions: Record<string, string> = {
    short: "Формат: краткая управленческая выжимка. Максимум 3-4 ключевых вывода, без деталей реализации. Объём — 1 экран.",
    medium: "Формат: сбалансированный материал. Выводы + обоснование + план действий. Объём — 2-3 экрана.",
    deep: "Формат: глубокий аналитический материал. Полный анализ опций, детальный план, метрики, риски, источники. Объём — 4-6 экранов.",
  };
  
  const outputFormatInstructions: Record<string, string> = {
    brief: "Структура: краткая записка. Заголовок → суть проблемы → рекомендация → обоснование → следующий шаг.",
    strategy: "Структура: стратегический документ. Контекст → анализ опций → рекомендуемая ставка → план → метрики → риски.",
    roadmap: "Структура: дорожная карта. Цель → этапы с датами и владельцами → контрольные точки → зависимости → риски.",
    presentation_outline: "Структура: план презентации. Слайды с заголовками и тезисами, логика повествования, ключевые данные для каждого слайда.",
    memo: "Структура: меморандум. Кому/от кого/дата → суть вопроса → факты → позиция → предлагаемое решение → запрашиваемое действие.",
  };

  // Дополнительный контекст для подготовки встречи
  const meetingContext =
    session.taskType === "meeting_preparation"
      ? [
          session.meetingWith ? `ЛПР / участник встречи: ${session.meetingWith}` : "",
          session.meetingDate ? `Дата / срок подготовки: ${session.meetingDate}` : "",
          session.meetingGoal ? `Цель встречи (что хотим получить): ${session.meetingGoal}` : "",
          session.meetingContext ? `Известный контекст / предыстория: ${session.meetingContext}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "";
  
  return [
    `Профиль сессии:`,
    `Роль автора: ${roleLabels[session.userRole]}`,
    `Тип материала: ${taskLabels[session.taskType]}`,
    `Аудитория (кому предназначен материал): ${session.audience}`,
    `Горизонт планирования: ${horizonLabels[session.horizon] ?? session.horizon}`,
    `Регион: ${session.region || "не указан (федеральный уровень)"}`,
    `Задача / вопрос: ${session.focusTopic || "не указан"}`,
    meetingContext,
    ``,
    `Инструкция по глубине: ${detailLevelInstructions[session.detailLevel] ?? session.detailLevel}`,
    `Инструкция по формату: ${outputFormatInstructions[session.outputFormat] ?? session.outputFormat}`,
    `Дополнительные требования: ${session.constraints.length ? session.constraints.join("; ") : "нет"}`,
    ``,
    `Запрос пользователя: ${prompt || session.focusTopic || "Сформируй стратегический материал"}`,
    `Проверяемость: используй только вводные сессии, правила, память и открытые источники из контекста. Не выдумывай факты, которых нет в источниках.`,
  ].filter(Boolean).join("\n");
}

async function generateBlock(session: SessionProfile, context: string, task: string, maxTokens: number) {
  const hasWebSources = context.includes("URL:") && !context.includes("Открытые источники недоступны");
  return callLLM({
    maxTokens,
    messages: [
      {
        role: "system",
        content: [
          "Ты стратегический AI-агент для госсектора. Отвечай только на русском.",
          modePrompt(session),
          "КРИТИЧЕСКИ ВАЖНО: Не выдумывай статистику, проценты, числа и факты без источника.",
          hasWebSources
            ? "Используй только факты из блока 'Открытые источники'. Каждый факт привязывай к источнику."
            : "Открытые источники недоступны. ЗАПРЕЩЕНО писать любые проценты, числа и статистику как факт. Вместо чисел пиши 'нужно снять базовую линию'. Формулируй только управленческую логику и гипотезы.",
          "Не предлагай сокращение штата. Допустимо: снижение ручной нагрузки, перераспределение сотрудников на контроль исключений.",
          "Не используй журналистские источники как основание для управленческих чисел.",
          "Пиши как для ВП/руководителя: решение, механизм эффекта, цена бездействия, следующий управленческий шаг.",
          "Не ограничивайся ИИ-решениями. Если более сильное решение процессное, финансовое, партнерское или правовое, выбирай его.",
        ].join("\n\n"),
      },
      {
        role: "user",
        content: `${context}\n\nЗадача:\n${task}`,
      },
    ],
  });
}

// ── Конфигурация секций и промптов по типу материала ─────────────────────────

interface SectionConfig {
  title: string;
  type: OutputSection["type"];
  blockKey: "directions" | "mvp" | "metrics" | "risksSber";
}

const SECTION_CONFIGS: Record<TaskType, SectionConfig[]> = {
  strategic_bets: [
    { title: "Три ставки и выбор", type: "actions", blockKey: "directions" },
    { title: "Пилот и первые шаги", type: "roadmap", blockKey: "mvp" },
    { title: "Метрики и экономика", type: "metrics", blockKey: "metrics" },
    { title: "Риски и роль Сбера", type: "risks", blockKey: "risksSber" },
  ],
  sber_region_strategy: [
    { title: "Портфель Сбера и ставка", type: "actions", blockKey: "directions" },
    { title: "План захода и продукты", type: "roadmap", blockKey: "mvp" },
    { title: "ЛПР и стейкхолдеры", type: "metrics", blockKey: "metrics" },
    { title: "Риски и конкуренция", type: "risks", blockKey: "risksSber" },
  ],
  region_strategy: [
    { title: "Бюджет и отраслевой контекст", type: "actions", blockKey: "directions" },
    { title: "Приоритеты региона на 5 лет", type: "roadmap", blockKey: "mvp" },
    { title: "Руководители, ведомства и поставщики", type: "metrics", blockKey: "metrics" },
    { title: "Сценарии развития региона", type: "risks", blockKey: "risksSber" },
  ],
  scenario_analysis: [
    { title: "Три сценария", type: "actions", blockKey: "directions" },
    { title: "Индикаторы и триггеры", type: "roadmap", blockKey: "mvp" },
    { title: "Метрики мониторинга", type: "metrics", blockKey: "metrics" },
    { title: "Риски и позиция Сбера", type: "risks", blockKey: "risksSber" },
  ],
  executive_brief: [
    { title: "Позиция и рекомендация", type: "actions", blockKey: "directions" },
    { title: "Обоснование и факты", type: "text", blockKey: "mvp" },
    { title: "Экономика и эффект", type: "metrics", blockKey: "metrics" },
    { title: "Риски и следующий шаг", type: "risks", blockKey: "risksSber" },
  ],
  meeting_preparation: [
    { title: "Повестка встречи", type: "actions", blockKey: "directions" },
    { title: "Что предлагаем и артефакт", type: "text", blockKey: "mvp" },
    { title: "Ключевые вопросы и возражения", type: "text", blockKey: "metrics" },
    { title: "Следующий шаг после встречи", type: "actions", blockKey: "risksSber" },
  ],
  meeting_followup: [
    { title: "Итоги и договорённости", type: "actions", blockKey: "directions" },
    { title: "Ответственные и сроки", type: "roadmap", blockKey: "mvp" },
    { title: "Открытые вопросы", type: "text", blockKey: "metrics" },
    { title: "Следующие шаги", type: "actions", blockKey: "risksSber" },
  ],
};

function buildNextSteps(session: SessionProfile): string[] {
  const { userRole, taskType, region, focusTopic } = session;
  const regionStr = region ? `в ${region}` : "";
  const topicShort = focusTopic?.slice(0, 40) ?? "по теме";

  const steps: Partial<Record<string, string[]>> = {
    "vice_president:executive_brief": [
      "Согласовать позицию с профильным ВП до конца недели",
      "Направить краткую записку в правление с запросом решения",
      "Назначить ответственного за реализацию позиции",
    ],
    "vice_president:scenario_analysis": [
      "Выбрать базовый сценарий и зафиксировать в протоколе",
      "Назначить владельца мониторинга триггеров",
      "Согласовать план действий для каждого сценария",
    ],
    "direction_head:strategic_bets": [
      "Выбрать одну ставку и согласовать с ВП до конца месяца",
      "Назначить владельца ставки и критерии go/no-go",
      "Запустить снятие baseline по выбранной ставке",
    ],
    "direction_head:roadmap": [
      "Согласовать дорожную карту с владельцами этапов",
      "Зафиксировать первую контрольную точку и дату",
      "Назначить встречу с заказчиком для подтверждения плана",
    ],
    "sales_lead:region_strategy": [
      `Запросить встречу с Минцифры ${regionStr} в течение 2 недель`,
      "Подготовить 1-страничный тизер для первого контакта",
      "Согласовать с региональной командой Сбера состав делегации",
    ],
    "sales_lead:meeting_preparation": [
      "Отправить письмо с предложением встречи и повесткой",
      "Подготовить 1-страничный материал для оставления заказчику",
      "Согласовать с командой Сбера кто едет и кто говорит что",
    ],
    "analyst:scenario_analysis": [
      "Представить сценарии руководителю направления",
      "Согласовать систему мониторинга триггеров",
      "Подготовить список данных для верификации допущений",
    ],
    "analyst:strategic_bets": [
      "Представить анализ конкурентов руководителю направления",
      "Согласовать приоритетные сегменты для усиления",
      "Подготовить список данных для верификации позиций конкурентов",
    ],
    "product_lead:product_hypothesis": [
      "Провести 5 интервью с потенциальными заказчиками за 2 недели",
      "Подготовить MVP-бриф для команды разработки",
      "Согласовать критерии подтверждения/опровержения гипотезы",
    ],
    "project_office:roadmap": [
      "Согласовать дорожную карту с проектным комитетом",
      "Назначить владельцев каждого этапа",
      "Зафиксировать первую контрольную точку и критерии приёмки",
    ],
    "project_office:meeting_preparation": [
      "Отправить письмо с предложением встречи и повесткой в течение 24 часов",
      "Подготовить 1-страничный материал для оставления заказчику",
      "Назначить следующую контрольную точку с проектным комитетом",
    ],
  };

  const key = `${userRole}:${taskType}`;
  return steps[key] ?? [
    "Согласовать следующий шаг с руководителем",
    `Снять baseline по теме: ${topicShort}`,
    "Назначить владельца результата",
  ];
}

function buildBlockPrompts(session: SessionProfile): {
  summaryPrompt: string;
  directionsPrompt: string;
  mvpPrompt: string;
  metricsPrompt: string;
  risksSberPrompt: string;
} {
  const { taskType, region } = session;
  const regionCtx = region ? `в ${region}` : "на федеральном уровне";

  switch (taskType) {
    case "meeting_preparation":
      return {
        summaryPrompt: "Напиши краткое резюме подготовки к встрече: 1) кто ЛПР и какая у него вероятная управленческая боль, 2) одно решение, которое Сбер хочет получить, 3) основной тезис Сбера, 4) что оставляем после встречи. До 600 знаков.",
        directionsPrompt: "Напиши сценарий встречи на 30 минут: 4-5 блоков с временем, кто говорит, какой тезис, какой вопрос задаем ЛПР и какое решение фиксируем. Не делай общую повестку — нужен сценарий разговора.",
        mvpPrompt: "Напиши пакет материалов, который Сбер должен принести и оставить после встречи: 1) одна страница для ЛПР, 2) расчет или демо, 3) проект письма/протокола, 4) следующий шаг с датой. Укажи, что именно готовит команда Сбера.",
        metricsPrompt: "Напиши карту возражений: 3-5 вероятных возражений ЛПР, короткий ответ Сбера, какие факты нужны для подтверждения, что спросить на встрече. Отдельно выдели неизвестные факты.",
        risksSberPrompt: "Напиши план после встречи: что сделать в течение 48 часов при трех исходах — согласие, пауза, отказ. Для каждого исхода: письмо/звонок/материал, владелец со стороны Сбера, дата следующего касания.",
      };

    case "scenario_analysis":
      return {
        summaryPrompt: `Напиши резюме сценарного анализа строго по этой структуре:
СЦЕНАРИЙ А: [название] — [1 предложение что происходит]
СЦЕНАРИЙ Б: [название] — [1 предложение что происходит]  
СЦЕНАРИЙ В: [название] — [1 предложение что происходит]
ПОЗИЦИЯ СБЕРА: [что делаем сейчас чтобы выиграть в любом сценарии]
СЛЕДУЮЩИЙ ШАГ: [конкретное действие]
Используй факты из открытых источников. До 600 знаков.`,
        directionsPrompt: `Напиши три сценария. Для КАЖДОГО сценария используй ТОЧНО эту структуру:

## СЦЕНАРИЙ 1: [НАЗВАНИЕ ЗАГЛАВНЫМИ]
- Вероятность: высокая / средняя / низкая
- Триггер: [конкретное событие которое запускает этот сценарий]
- Что происходит: [2-3 предложения — что меняется в госсекторе]
- Роль Сбера: [конкретный продукт Сбера + конкретное действие]
- Международный опыт: [страна + что они сделали]

## СЦЕНАРИЙ 2: [НАЗВАНИЕ ЗАГЛАВНЫМИ]
[та же структура]

## СЦЕНАРИЙ 3: [НАЗВАНИЕ ЗАГЛАВНЫМИ]
[та же структура]

Используй только факты из открытых источников. Не выдумывай числа.`,
        mvpPrompt: `Напиши систему мониторинга сценариев. Для КАЖДОГО из 5-7 индикаторов:
- Индикатор: [название]
- Источник: [где берём данные]
- Порог: [при каком значении меняем сценарий]
- Периодичность: [как часто проверяем]

Пример:
- Индикатор: Доля электронных госуслуг
- Источник: Минцифры РФ, ежегодный отчёт
- Порог: рост более чем на 10 п.п. за год → переход к сценарию Либерализация
- Периодичность: ежеквартально`,
        metricsPrompt: `Напиши метрики мониторинга для каждого сценария. Формат таблицы:
| Метрика | Сценарий А | Сценарий Б | Сценарий В | Источник |
Заполни 4-5 строк. Без выдуманных чисел — только формулы и источники.`,
        risksSberPrompt: `Напиши три раздела:
1. РИСКИ ДЛЯ СБЕРА в каждом сценарии — по 1-2 конкретных риска
2. ПОЗИЦИЯ СБЕРА СЕЙЧАС — что делаем независимо от сценария (конкретный продукт, конкретное действие)
3. ЧТО ПРОВЕРИТЬ — список из 3-5 фактов которые нужно верифицировать`,
      };

    case "meeting_followup":
      return {
        summaryPrompt: "Напиши резюме follow-up встречи: ключевая договорённость, ответственные, дедлайн. До 500 знаков.",
        directionsPrompt: "Структурируй итоги встречи: 1) ключевые решения, 2) что подтверждено, 3) что отложено и почему, 4) открытые вопросы.",
        mvpPrompt: "Построй матрицу обязательств: для каждого обязательства — кто отвечает, что именно делает, дедлайн, критерий выполнения.",
        metricsPrompt: "Список открытых вопросов с тем, кто обеспечивает ответ и когда.",
        risksSberPrompt: "Следующие шаги Сбера за 48 часов: письмо, расчёт, встреча. Владелец по каждому шагу.",
      };

    case "sber_region_strategy":
      return {
        summaryPrompt: `Напиши резюме стратегии Сбера ${regionCtx}: 1) главная ставка Сбера в регионе, 2) ключевой продукт, 3) через кого заходим, 4) что делаем в ближайший квартал. До 600 знаков.`,
        directionsPrompt: `Напиши портфель Сбера ${regionCtx}: 1) какие продукты Сбера релевантны для этого региона и почему, 2) что уже продано/пилотируется, 3) что отклонили и почему, 4) главная ставка на квартал — конкретный продукт + конкретный заказчик.`,
        mvpPrompt: `Напиши план захода Сбера ${regionCtx}: 1) кому звоним первым и с каким предложением, 2) какой артефакт готовим (1-страничник, демо, расчёт), 3) MVP на 8 недель — что делаем, 4) критерии успеха пилота.`,
        metricsPrompt: `Напиши карту ЛПР ${regionCtx} с позиции Сбера: для каждого ЛПР — что он хочет, что боится, какой продукт Сбера ему релевантен, через кого выходим, какой артефакт нужен.`,
        risksSberPrompt: `Напиши: 1) конкуренты Сбера в регионе (кто ещё заходит, с чем), 2) риски для Сбера (политические, технические, репутационные), 3) как снять каждый риск, 4) что нужно проверить перед стартом.`,
      };

    case "executive_brief":
      return {
        summaryPrompt: "Напиши краткую записку для ВП: 1 абзац — суть проблемы, 1 абзац — рекомендация Сбера, 1 строка — следующий шаг. Максимум 500 знаков. Никакой воды.",
        directionsPrompt: "Напиши позицию и обоснование: 1) рекомендуемое решение с механизмом эффекта, 2) почему именно сейчас (факты из источников), 3) альтернативы которые рассмотрели и почему отклонили.",
        mvpPrompt: "Напиши обоснование: 3-5 фактов из открытых источников которые поддерживают рекомендацию. Каждый факт — источник и что из него следует для решения.",
        metricsPrompt: "Напиши экономику: как измерим эффект, формула расчёта, источник данных для baseline. Без выдуманных чисел.",
        risksSberPrompt: "Напиши: 1) 2-3 ключевых риска и как их снять, 2) конкретная роль Сбера — что делаем в первые 2 недели, 3) следующий управленческий шаг с датой.",
      };

    case "region_strategy":
      return {
        summaryPrompt: `Напиши резюме анализа региона ${regionCtx}: 1) чем регион управленчески важен, 2) что подтверждено источниками по бюджету и отраслям, 3) какой главный вывод на 5-летнем горизонте. До 600 знаков. Без продажной логики.`,
        directionsPrompt: `Напиши региональный анализ: 1) экономический профиль региона, 2) отраслевая структура и крупные организации только при наличии источника, 3) бюджетный контур, 4) стратегические приоритеты на 5 лет, 5) что проверить дополнительно.`,
        mvpPrompt: `Напиши сценарии развития региона на 5 лет: базовый, ускоренный, стрессовый и отраслевой/инфраструктурный. Для каждого: триггер, действия региона, бюджетные последствия, эффект для отраслей, ранние признаки.`,
        metricsPrompt: `Напиши карту проверяемых показателей региона: показатель, источник, периодичность, зачем нужен для анализа. Без выдуманных чисел.`,
        risksSberPrompt: `Напиши региональные риски и ограничения: бюджетные, отраслевые, кадровые, инфраструктурные, регуляторные. Для каждого: факт или гипотеза, источник/где проверить, управленческое последствие.`,
      };

    case "strategic_bets":
    default:
      return {
        summaryPrompt: "Напиши первый экран: 1) управленческая ставка, 2) почему это важно сейчас (факты из источников), 3) что конкретно делает Сбер, 4) следующий управленческий шаг. До 800 знаков. Не начинай с 'запускаем пилот'.",
        directionsPrompt: "Напиши три ставки из разных типов решений: процессное, финансовое/партнёрское, технологическое. Для каждой: управленческая логика, факты из источников, что проверить, критерий go/no-go. Не используй пустые слова без механизма.",
        mvpPrompt: "Напиши управляемый пилот на 8 недель: данные, правовой контур, интеграции, пилотная зона, критерии остановки. 4 этапа по 2 недели.",
        metricsPrompt: "Напиши метрики: результат, экономика, качество сервиса, риск/комплаенс. Для каждой — формула и источник данных. Без выдуманных чисел.",
        risksSberPrompt: "Напиши: 1) ключевые риски и как снять, 2) роль Сбера — конкретный актив, первые 2 недели, данные/интеграции, артефакт для заказчика, 3) что нужно проверить источниками.",
      };
  }
}

function assembleOutput(
  session: SessionProfile,
  blocks: { summary: string; directions: string; mvp: string; metrics: string; risksSber: string },
  activePlaybooks: Array<{ name: string; rules: string[] }>,
  memories: Array<{ title: string; excerpt: string }>,
  webEvidence: WebEvidence[],
): AgentOutput {
  // Секции под тип материала
  const sectionConfigs = SECTION_CONFIGS[session.taskType] ?? SECTION_CONFIGS.strategic_bets;
  const blockMap = {
    directions: blocks.directions,
    mvp: blocks.mvp,
    metrics: blocks.metrics,
    risksSber: blocks.risksSber,
  };
  const sections: OutputSection[] = sectionConfigs.map((cfg) => ({
    id: createId("sec"),
    title: cfg.title,
    content: blockMap[cfg.blockKey],
    type: cfg.type,
  }));
  const sources: OutputSource[] = [
    {
      title: "Вводные сессии",
      type: "session_input",
      excerpt: `${session.focusTopic || "фокус не указан"}; регион: ${session.region || "не указан"}; аудитория: ${session.audience}`,
      status: "used",
    },
    ...activePlaybooks.map((playbook) => ({
      title: playbook.name,
      type: "playbook" as const,
      excerpt: playbook.rules.slice(0, 3).join("; "),
      status: "used" as const,
    })),
    ...memories.slice(0, 5).map((memory) => ({
      title: memory.title,
      type: "memory" as const,
      excerpt: memory.excerpt.slice(0, 400),
      status: "used" as const,
    })),
    ...webEvidence.map((item) => ({
      title: item.title,
      type: "external_required" as const,
      excerpt: `${item.source}: ${item.snippet}`,
      status: "used" as const,
      url: item.url,
    })),
    ...(webEvidence.length
      ? []
      : [{
          title: "Открытые источники не найдены",
          type: "external_required" as const,
          excerpt: "Нужно вручную подтвердить факты: региональная статистика, действующие программы, бюджет, SLA, ограничения по данным.",
          status: "needs_check" as const,
        }]),
  ];
  const recommendations = extractLines(`${blocks.summary}\n${blocks.directions}\n${blocks.mvp}`, 4);
  const risks = extractLines(blocks.risksSber, 4);
  const markdown = sections.map((section) => `## ${section.title}\n\n${section.content}`).join("\n\n");
  return {
    id: createId("out"),
    sessionId: session.id,
    title: session.title?.trim() || session.focusTopic || "Стратегический материал",
    type: session.taskType,
    summary: blocks.summary,
    sections,
    recommendations: recommendations.length ? recommendations : ["Согласовать управленческую ставку", "Проверить внешние данные перед презентацией"],
    risks: risks.length ? risks : ["Недостаточно подтвержденных внешних источников", "Нужна проверка экономического эффекта"],
    nextSteps: buildNextSteps(session),
    markdown,
    createdAt: nowIso(),
    sources,
  };
}

function hardenOutput(output: AgentOutput): AgentOutput {
  const clean = (value: string) =>
    value
      // Сокращение штата — всегда убираем
      .replace(/сокращени[ея]\s+штат[а-я\s]*(?:на\s*)?\d{1,3}(?:[-–]\d{1,3})?\s*%/gi, "снижение ручной нагрузки с перераспределением сотрудников на контроль исключений")
      .replace(/сокращени[ея]\s+штат[а-я\s]*/gi, "снижение ручной нагрузки ")
      // SLA с конкретным числом без источника
      .replace(/SLA\s*[><=]\s*\d{1,3}\s*%/gi, "SLA — нужно снять базовую линию")
      // Убираем только числа которые явно выдуманы: "позволит сократить X%", "обеспечить экономию X%"
      // НО оставляем числа которые идут после "по данным", "согласно", "источник:", в скобках со ссылкой
      .replace(/(?:позволит|обеспечит|даст|принесёт|сэкономит)\s+(?:\w+\s+){0,3}\d{1,3}(?:[-–]\d{1,3})?\s*%(?!\s*\()/gi, (match) => {
        return match.replace(/\d{1,3}(?:[-–]\d{1,3})?\s*%/, "нужно снять базовую линию");
      })
      // Убираем выдуманные суммы без источника: "150 млрд руб", "до 50 млрд"
      .replace(/(?:до|около|порядка|свыше)\s+\d+\s*(?:млрд|млн)\s*руб(?!\s*\()/gi, "нужно снять базовую линию")
      // Убираем дублирование фразы
      .replace(/(нужно снять базовую линию[,.]?\s*){2,}/gi, "нужно снять базовую линию")
      .replace(/долгосроя/gi, "долгового управления")
      .replace(/чат-боты и классификаторы обращений/gi, "классификация и маршрутизация обращений")
      .trim();

  return {
    ...output,
    summary: clean(output.summary),
    sections: output.sections.map((section) => ({ ...section, content: clean(section.content) })),
    recommendations: output.recommendations.map(clean),
    risks: output.risks.map(clean),
    nextSteps: output.nextSteps.map(clean),
    markdown: clean(output.markdown),
  };
}

function extractLines(text: string, limit: number) {
  return text
    .split("\n")
    .map((line) => line.replace(/^[-*\d.)\s]+/, "").trim())
    .filter((line) => line.length > 20)
    .slice(0, limit);
}

/**
 * Резолвим регион сессии в RegionProfile.
 * Сначала пробуем по regionId если он пришёл явно, иначе по названию.
 */
async function resolveRegionForSession(session: SessionProfile) {
  const storage = getStorage();
  if (session.regionId) {
    const byId = await storage.getRegion(session.regionId);
    if (byId) return byId;
  }
  if (session.region) {
    const all = await storage.listRegions();
    const normalized = session.region.trim().toLowerCase();
    return (
      all.find((item) => item.name.toLowerCase() === normalized) ??
      all.find((item) => item.slug === normalized) ??
      all.find((item) => normalized.includes(item.slug) || item.name.toLowerCase().includes(normalized)) ??
      null
    );
  }
  return null;
}

export async function runInteractiveAction(request: ActionRequest) {
  const storage = getStorage();
  const playbooks = await storage.listPlaybooks();
  const activePlaybooks = selectRelevantPlaybooks(request.sessionProfile, playbooks);
  const region = await resolveRegionForSession(request.sessionProfile);
  const current = await storage.getOutput(request.outputId);
  const webEvidence = await retrieveOpenSources({
    region: request.sessionProfile.region,
    focusTopic: request.sessionProfile.focusTopic,
  });
  const outputForPrompt: AgentOutput =
    current ??
    parseAgentOutput(request.currentContent, request.sessionId, request.sessionProfile.taskType);
  const raw = await callLLM({
    messages: buildActionMessages(
      request.sessionProfile,
      activePlaybooks,
      request.actionType,
      outputForPrompt,
      formatEvidenceForPrompt(webEvidence),
      region,
    ),
  });
  const output = parseAgentOutput(raw, request.sessionId, request.actionType);
  await storage.saveOutput(output);

  if (request.actionType === "save_to_playbook") {
    const target = activePlaybooks[0] ?? (await storage.getPlaybook("strategy_mode"));
    if (target) {
      await storage.updatePlaybook(
        target.id,
        {
          name: target.name,
          description: target.description,
          rules: [...target.rules, "Пользователь сохранил интерактивный вывод как правило для повторного применения."],
          template: target.template,
        },
        "Интерактивный вывод сохранен в правила",
      );
    }
  }

  return { output, activePlaybooks };
}
