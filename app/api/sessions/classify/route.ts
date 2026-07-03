import { NextResponse } from "next/server";
import { callLLM } from "@/lib/agents/llm-client";
import {
  deliveryFormats,
  detailLevels,
  horizons,
  taskLabels,
  taskTypes,
  urgencyLevels,
} from "@/lib/schemas/session";
import { getStorage } from "@/lib/storage/local-json-storage";
import { tryParseJson } from "@/lib/utils/json";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_PHRASE_LENGTH = 2000;

/** Контекстный уточняющий вопрос, сгенерированный LLM под конкретный бриф. */
export type Clarification = { question: string; options?: string[] };

/**
 * Санитизация clarifications из ответа LLM: отбрасываем мусор, ограничиваем
 * до 2 вопросов, options — 2-4 непустых строки (иначе свободный ввод).
 */
function normalizeClarifications(raw: unknown): Clarification[] {
  if (!Array.isArray(raw)) return [];
  const result: Clarification[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const question = (item as Record<string, unknown>).question;
    if (typeof question !== "string" || question.trim().length < 3) continue;
    const rawOptions = (item as Record<string, unknown>).options;
    let options: string[] | undefined;
    if (Array.isArray(rawOptions)) {
      const cleaned = rawOptions
        .filter((o): o is string => typeof o === "string" && o.trim().length > 0)
        .map((o) => o.trim())
        .slice(0, 4);
      if (cleaned.length >= 2) options = cleaned;
    }
    result.push(options ? { question: question.trim(), options } : { question: question.trim() });
    if (result.length >= 2) break;
  }
  return result;
}

/**
 * Контекстный запасной вопрос под конкретный тип задачи, если модель не задала
 * ни одного уточнения, а бриф неполный. НЕ общий анкетный шаблон: вопрос
 * привязан к типу материала и к тому, чего в брифе не хватает.
 */
function fallbackClarification(
  taskType: string,
  missing: { focus: boolean; goal: boolean },
): Clarification | null {
  switch (taskType) {
    case "meeting_preparation":
      return missing.goal
        ? {
            question: "Что хотите получить от встречи?",
            options: ["Договорённость о пилоте", "Доступ к данным / статистике", "Знакомство и интерес", "Другое"],
          }
        : {
            question: "Была ли у Сбера история с этим ведомством? Это то, чего нет в открытых источниках.",
          };
    case "meeting_followup":
      return { question: "Что было ключевым итогом встречи — о чём договорились и что осталось открытым?" };
    case "executive_brief":
      return { question: "Какое решение должен принять ВП по итогам этой позиции?" };
    case "region_strategy":
    case "sber_region_strategy":
      return {
        question: "Что в приоритете в анализе?",
        options: ["Бюджет", "Отрасли", "Приоритеты", "Сценарии", "Всё сразу"],
      };
    case "strategic_bets":
      return { question: "Какие направления уже рассматривали или, наоборот, точно исключаете?" };
    case "scenario_analysis":
      return { question: "Какое изменение (регулирование, бюджет, нацпроект) должно запускать сценарии?" };
    default:
      return missing.focus
        ? { question: "Уточните, что именно нужно подготовить и с какой целью?" }
        : null;
  }
}

/**
 * Неполон ли бриф: нет ясной темы/фокуса ИЛИ (для встреч) нет цели.
 * Если бриф уже полон — уточнения не навязываем (модель могла вернуть []).
 */
function briefIncomplete(parsed: Record<string, unknown>): { focus: boolean; goal: boolean; any: boolean } {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const focus = str(parsed.focusTopic).length < 8;
  const taskType = str(parsed.taskType);
  const isMeeting = taskType === "meeting_preparation" || taskType === "meeting_followup";
  const goal = isMeeting && str(parsed.meetingGoal).length < 4 && str(parsed.meetingContext).length < 8;
  return { focus, goal, any: focus || goal };
}

const systemPrompt = `Ты — помощник руководителя департамента по работе с госсектором Сбербанка.
Ты получаешь одну фразу руководителя и должен предложить заполнение формы "Новая стратегическая сессия".

ОТВЕЧАЙ ТОЛЬКО ВАЛИДНЫМ JSON без markdown-fences и пояснений.
Схема ответа:
{
  "taskType": один из: ${taskTypes.join(", ")},
  "focusTopic": краткое изложение задачи (1-2 предложения),
  "title": короткое название для списка (до 60 символов, без кавычек),
  "meetingWith": кто ЛПР встречи, если это встреча (иначе ""),
  "meetingDate": дата встречи в свободной форме (иначе ""),
  "meetingGoal": что хотим получить от встречи (иначе ""),
  "meetingContext": что известно о ЛПР или повестке (иначе ""),
  "region": регион, если упомянут (иначе ""),
  "regionId": id региона из справочника, если определён, иначе "",
  "horizon": один из: ${horizons.join(", ")}, если применимо, иначе "12_months",
  "detailLevel": один из: ${detailLevels.join(", ")}, иначе "medium",
  "urgency": один из: ${urgencyLevels.join(", ")}, если есть явный срок, иначе "24h",
  "deliveryFormat": один из: ${deliveryFormats.join(", ")}, иначе "workspace",
  "constraints": массив строк — дополнительные требования, если названы,
  "clarifications": массив из 0-2 объектов { "question": string, "options"?: string[] } — контекстные уточняющие вопросы под этот бриф (см. правила ниже)
}

Лейблы типов задач для распознавания:
${Object.entries(taskLabels)
  .map(([value, label]) => `- ${value}: "${label}"`)
  .join("\n")}

Правила:
- Если фраза содержит слово "встреча", "подготовка к встрече", "едем к", "идём к", "завтра у", выбери meeting_preparation.
- Если "после встречи", "итоги", "фиксируем договорённости", выбери meeting_followup.
- Если "для ВП", "позиция для правления", выбери executive_brief.
- Если "анализ региона", "изучить регион", "понять регион", "разбор региона", выбери region_strategy.
- Если "саммари по региону", "обзор региона", "отрасли региона", "приоритеты региона", "бюджет региона", "структура бюджета", "стратегия региона", "что происходит в регионе" — это информационно-аналитический срез о самом регионе, выбери region_strategy.
- Если "стратегия Сбера в регионе", "портфель Сбера", "что продаём в регионе", "план действий Сбера", "обновить стратегию Сбера по региону" — речь про действия Сбера, выбери sber_region_strategy.
- Если упомянут регион (область, край, республика, город федерального значения) и НЕТ встречи/ВП/сценариев/ставок — по умолчанию выбери region_strategy (аналитический срез), а не strategic_bets.
- Если "куда идти", "выбрать направление", "ставки", выбери strategic_bets.
- Если "сценарии", "что если", "при изменении ФЗ", выбери scenario_analysis.
- Если сказано "через 2 часа", "срочно" → urgency="2_hours".
- Если "сегодня" → "today", "завтра"/"24 часа" → "24h", "неделя" → "week", без срока → "24h".
- horizon: если руководитель говорит про "5 лет", "на будущее", "до 2030", "долгосрочно" → "2030". Если "на год" → "12_months". По умолчанию для region_strategy → "2030".

Правила для "clarifications" (уточняющие вопросы):
- Если из брифа НЕ ясны тема/фокус или (для встречи) цель — задай 1-2 КОНКРЕТНЫХ вопроса, которые реально изменят результат. Неполный бриф без вопросов — плохо.
- Если бриф уже полный (ясны тип, тема/цель и, для встречи, что хотим получить) — верни [] (пустой массив). Не задавай вопрос ради вопроса.
- Вопросы КОНКРЕТНЫЕ под эту задачу и её тип, а не общие анкетные шаблоны. ЗАПРЕЩЕНО задавать общие шаблоны вроде «Какого результата хотите? Максимум и минимум», «Что уже знаете», «Опишите задачу подробнее» — они бесполезны.
- Хорошие примеры (встреча с министром образования, тема не названа): { "question": "Какая тема встречи?", "options": ["Цифровизация школ", "Приёмная кампания и ЕГЭ", "Финансирование нацпроекта", "Другое"] }; либо { "question": "Что хотите получить от встречи — договорённость о пилоте, доступ к данным, знакомство?" }.
- Для region_strategy без явного фокуса: { "question": "Что в приоритете в анализе?", "options": ["Бюджет", "Отрасли", "Конкуренты", "Сценарии", "Всё сразу"] }.
- "options" — 2-4 коротких варианта, когда ответ выбираемый из конечного набора. Если ответ свободный (тема, цель, нюанс) — НЕ давай "options", будет свободный ввод.
- Формулировки строгие и деловые, без эмодзи и панибратства. Один вопрос — один объект.
- Регион НЕ спрашивай в clarifications (регион уточняется отдельным механизмом формы).
`;

export async function POST(request: Request) {
  try {
    const { phrase } = (await request.json()) as { phrase?: string };
    if (!phrase || phrase.trim().length < 3) {
      return NextResponse.json({ error: "Phrase too short" }, { status: 400 });
    }
    if (phrase.length > MAX_PHRASE_LENGTH) {
      return NextResponse.json({ error: "Phrase too long" }, { status: 400 });
    }
    const regions = await getStorage().listRegions();
    const regionHints = regions
      .map((r) => `- ${r.name} (id=${r.id}, slug=${r.slug})`)
      .join("\n");

    const raw = await callLLM({
      temperature: 0.1,
      maxTokens: 700,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Справочник регионов:\n${regionHints}\n\nФраза руководителя:\n${phrase.trim()}\n\nВерни JSON.`,
        },
      ],
    });

    const parsed = tryParseJson<Record<string, unknown>>(raw);
    // Нормализуем clarifications: максимум 2 валидных вопроса, options — 2-4 строки.
    const clarifications = normalizeClarifications(parsed.clarifications);
    // Гарантия: если бриф неполный, а модель не задала вопросов — добавляем один
    // КОНТЕКСТНЫЙ (под тип задачи и то, чего не хватает), а не шаблонный.
    if (clarifications.length === 0) {
      const gap = briefIncomplete(parsed);
      if (gap.any) {
        const fallback = fallbackClarification(String(parsed.taskType ?? ""), gap);
        if (fallback) clarifications.push(fallback);
      }
    }
    parsed.clarifications = clarifications;
    return NextResponse.json({ suggestion: parsed, clarifications });
  } catch (error) {
    console.error("[classify]", error);
    return NextResponse.json({ error: "Classification failed" }, { status: 500 });
  }
}
