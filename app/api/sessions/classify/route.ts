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

export const runtime = "nodejs";
export const maxDuration = 60;

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
  "constraints": массив строк — дополнительные требования, если названы
}

Лейблы типов задач для распознавания:
${Object.entries(taskLabels)
  .map(([value, label]) => `- ${value}: "${label}"`)
  .join("\n")}

Правила:
- Если фраза содержит слово "встреча", "подготовка к встрече", "едем к", "идём к", "завтра у", выбери meeting_preparation.
- Если "после встречи", "итоги", "фиксируем договорённости", выбери meeting_followup.
- Если "для ВП", "позиция для правления", выбери executive_brief.
- Если "анализ региона", "первый заход в", "изучить регион", "понять регион", "разбор региона", выбери region_strategy.
- Если "саммари по региону", "обзор региона", "отрасли региона", "приоритеты региона", "бюджет региона", "структура бюджета", "стратегия региона", "что происходит в регионе" — это информационно-аналитический срез о самом регионе, выбери region_strategy.
- Если "стратегия Сбера в регионе", "портфель Сбера", "что продаём в регионе", "план захода Сбера", "обновить стратегию по региону" — речь про действия Сбера, выбери sber_region_strategy.
- Если упомянут регион (область, край, республика, город федерального значения) и НЕТ встречи/ВП/сценариев/ставок — по умолчанию выбери region_strategy (аналитический срез), а не strategic_bets.
- Если "куда идти", "выбрать направление", "ставки", выбери strategic_bets.
- Если "сценарии", "что если", "при изменении ФЗ", выбери scenario_analysis.
- Если сказано "через 2 часа", "срочно" → urgency="2_hours".
- Если "сегодня" → "today", "завтра"/"24 часа" → "24h", "неделя" → "week", без срока → "24h".
- horizon: если руководитель говорит про "5 лет", "на будущее", "до 2030", "долгосрочно" → "2030". Если "на год" → "12_months". По умолчанию для region_strategy → "2030".
`;

export async function POST(request: Request) {
  try {
    const { phrase } = (await request.json()) as { phrase?: string };
    if (!phrase || phrase.trim().length < 3) {
      return NextResponse.json({ error: "Фраза слишком короткая" }, { status: 400 });
    }
    const regions = await getStorage().listRegions();
    const regionHints = regions
      .map((r) => `- ${r.name} (id=${r.id}, slug=${r.slug})`)
      .join("\n");

    const raw = await callLLM({
      temperature: 0.1,
      maxTokens: 500,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Справочник регионов:\n${regionHints}\n\nФраза руководителя:\n${phrase.trim()}\n\nВерни JSON.`,
        },
      ],
    });

    // Парсим, отрезаем возможные markdown-фенсы на всякий случай.
    const json = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(json) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: "Модель вернула невалидный JSON", raw },
        { status: 502 },
      );
    }
    return NextResponse.json({ suggestion: parsed });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Classify error" },
      { status: 500 },
    );
  }
}
