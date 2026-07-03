/**
 * ЕДИНЫЙ РЕЕСТР БЛОКОВ МАТЕРИАЛА — единственный источник правды для:
 *  - UI («План материала» в ChatFlow и ручной форме),
 *  - генерации (директива модели о составе и порядке блоков),
 *  - рендера дашбордов (порядок и пропуск секций).
 *
 * id блоков — стабильные строки, синхронизированные с секциями дашбордов
 * (components/strategy/structured/*). Для region id совпадают с ключами
 * sectionOrder (CLASSIC_SECTION_KINDS в lib/agents/region-blocks/types.ts).
 *
 * `core: true` — блок входит всегда и включён по умолчанию при любом объёме.
 * `situational: true` — не-core блок, который включается уже на «Средне»
 * (в отличие от глубоко-специфичных, появляющихся только на «Глубоко»).
 */

import type { DetailLevel, TaskType } from "@/lib/schemas/session";

export type MaterialBlock = {
  /** Стабильный id, совпадает с секцией дашборда / ключом sectionOrder. */
  id: string;
  /** Человекочитаемое название (идёт в директиву модели и в UI). */
  label: string;
  /** Ядро материала — включено всегда, при любом объёме. */
  core: boolean;
  /** Не-core, но входит уже на «Средне» (ситуативный). Иначе — только «Глубоко». */
  situational?: boolean;
  /** Короткая подпись под блоком (что внутри) — для строки плана. */
  hint?: string;
};

/**
 * Состав материала по типам задач, В ПОРЯДКЕ рендера дашборда по умолчанию.
 * Названия и порядок синхронизированы с реальными секциями дашбордов.
 */
export const MATERIAL_PLAN: Record<TaskType, MaterialBlock[]> = {
  meeting_preparation: [
    { id: "ministry", label: "Портрет ведомства и повестки", core: true, hint: "бюджет, инициативы, конкуренты" },
    { id: "dossier", label: "Досье ЛПР", core: true, hint: "роль, мотив, история, зона решений" },
    { id: "participants", label: "Карта участников", core: false, situational: true, hint: "роли и отношение" },
    { id: "theses", label: "Тезисы под повестку ЛПР", core: true, hint: "привязка к фактам" },
    { id: "sber", label: "Участие Сбера", core: true, hint: "актив, первые 2 недели, артефакт" },
    { id: "agenda", label: "Сценарий встречи", core: true, hint: "блоки по времени" },
    { id: "objections", label: "Возражения", core: false, situational: true, hint: "причина, ответ, запасной ход" },
    { id: "after", label: "После встречи", core: true, hint: "исходы и первые 48 часов" },
    { id: "sources", label: "Источники", core: true, hint: "проверяемые ссылки" },
  ],
  meeting_followup: [
    { id: "ministry", label: "Контекст встречи", core: true, hint: "с кем и о чём" },
    { id: "theses", label: "Итоги и договорённости", core: true, hint: "что решили" },
    { id: "after", label: "Ответственные и следующие шаги", core: true, hint: "кто, что, когда" },
    { id: "objections", label: "Открытые вопросы", core: false, situational: true, hint: "что осталось нерешённым" },
    { id: "sber", label: "Действия Сбера", core: true, hint: "первые 48 часов" },
    { id: "sources", label: "Источники", core: true, hint: "проверяемые ссылки" },
  ],
  executive_brief: [
    { id: "decision", label: "Решение", core: true, hint: "что делаем и почему" },
    { id: "evidence", label: "Доказательства", core: true, hint: "факты с источниками" },
    { id: "economics", label: "Экономика", core: false, situational: true, hint: "эффект одной формулой" },
    { id: "risks", label: "Риски", core: true, hint: "и меры снятия" },
    { id: "sber-actions", label: "Действия Сбера", core: false, hint: "актив, данные, артефакт" },
    { id: "next-steps", label: "Следующий шаг", core: true, hint: "один, с датой" },
    { id: "sources", label: "Источники", core: true, hint: "проверяемые ссылки" },
  ],
  // region_strategy / sber_region_strategy: id совпадают с ключами sectionOrder
  // (CLASSIC_SECTION_KINDS). Порядок и включённость реально управляют дашбордом.
  // scenarios — core: их требует блочный orchestrator и гейт готовности сборки,
  // поэтому в UI они не отключаемы (но переставляемы). competition/stakeholders —
  // опциональны и реально управляют составом (region-blocks/planner).
  region_strategy: [
    { id: "industries", label: "Отрасли", core: true, hint: "опорные отрасли и предприятия" },
    { id: "budget", label: "Бюджет", core: true, hint: "структура расходов и программы" },
    { id: "priorities", label: "Приоритеты", core: true, hint: "стратегия региона на 5 лет" },
    { id: "scenarios", label: "Сценарии", core: true, hint: "как может развиваться регион" },
    { id: "competition", label: "Конкуренты", core: false, situational: true, hint: "поставщики и альтернативы" },
    { id: "stakeholders", label: "Руководители и ведомства", core: false, hint: "кто принимает решения" },
  ],
  sber_region_strategy: [
    { id: "industries", label: "Отрасли", core: true, hint: "опорные отрасли и предприятия" },
    { id: "budget", label: "Бюджет", core: true, hint: "структура расходов и программы" },
    { id: "priorities", label: "Приоритеты", core: true, hint: "стратегия региона на 5 лет" },
    { id: "scenarios", label: "Сценарии", core: true, hint: "как может развиваться регион" },
    { id: "competition", label: "Конкуренты", core: false, situational: true, hint: "поставщики и альтернативы" },
    { id: "stakeholders", label: "Руководители и ведомства", core: false, hint: "кто принимает решения" },
  ],
  strategic_bets: [
    { id: "bets", label: "Ставки", core: true, hint: "3-4 направления" },
    { id: "matrix", label: "Матрица выбора", core: true, hint: "эффект × реализуемость" },
    { id: "plan", label: "План", core: true, hint: "этапы и вехи" },
    { id: "metrics", label: "Метрики", core: false, situational: true, hint: "baseline → target" },
    { id: "risks", label: "Риски", core: true, hint: "и меры снятия" },
    { id: "next-steps", label: "Следующие шаги", core: true, hint: "с владельцами и сроками" },
  ],
  scenario_analysis: [
    { id: "scenarios", label: "Сценарии", core: true, hint: "3 варианта развития" },
    { id: "triggers", label: "Триггеры", core: true, hint: "что запускает сценарий" },
    { id: "sber-position", label: "Позиция Сбера", core: true, hint: "действия в каждом сценарии" },
    { id: "signals", label: "Ранние сигналы", core: false, situational: true, hint: "что мониторить" },
  ],
};

/** Список блоков по типу задачи (в порядке по умолчанию). */
export function blocksForTask(taskType: TaskType): MaterialBlock[] {
  return MATERIAL_PLAN[taskType] ?? [];
}

/** Быстрый доступ к блоку по id. */
export function blockById(taskType: TaskType, id: string): MaterialBlock | undefined {
  return blocksForTask(taskType).find((b) => b.id === id);
}

/**
 * Включён ли блок ПО УМОЛЧАНИЮ при заданном объёме:
 *  - Коротко (short) — только core;
 *  - Средне (medium) — core + ситуативные;
 *  - Глубоко (deep) — все.
 */
export function isBlockDefaultOn(block: MaterialBlock, volume: DetailLevel): boolean {
  if (block.core) return true;
  if (volume === "deep") return true;
  if (volume === "medium") return Boolean(block.situational);
  return false; // short
}

/**
 * Стартовый набор ВКЛЮЧЁННЫХ id (в порядке по умолчанию) для объёма.
 * Используется при инициализации плана в UI.
 */
export function defaultEnabledIds(taskType: TaskType, volume: DetailLevel): string[] {
  return blocksForTask(taskType)
    .filter((b) => isBlockDefaultOn(b, volume))
    .map((b) => b.id);
}

/** Метка объёма для человека / директивы модели. */
export const VOLUME_LABEL: Record<DetailLevel, string> = {
  short: "Коротко",
  medium: "Средне",
  deep: "Глубоко",
};

/**
 * Инструкция по глубине проработки для промпта — делает Коротко/Средне/Глубоко
 * реально различными (объём текста, число пунктов, детализация).
 */
export const VOLUME_DIRECTIVE: Record<DetailLevel, string> = {
  short:
    "Объём: КОРОТКО. Только суть по каждому блоку: 1-2 предложения или до 3 пунктов. Минимум пояснений, без второстепенных деталей. Массивы (тезисы, возражения, сценарии, шаги) — по нижней границе диапазона.",
  medium:
    "Объём: СРЕДНЕ. Сбалансированная проработка: ключевые пункты с короткими обоснованиями. Массивы — по середине диапазона. Без избыточных деталей.",
  deep:
    "Объём: ГЛУБОКО. Максимальная проработка: развёрнутые обоснования, все нюансы, доказательная база к каждому пункту. Массивы — по верхней границе диапазона; добавляй вторичные блоки и детали, где они содержательны.",
};

/**
 * Директива состава/порядка блоков для системного промпта генератора.
 * Возвращает пустую строку, если materialPlan не задан (обратная совместимость).
 */
export function buildMaterialPlanDirective(
  taskType: TaskType,
  plan: { blocks?: string[]; volume?: DetailLevel } | undefined,
): string {
  if (!plan) return "";
  const volume = plan.volume;
  const lines: string[] = [];

  const enabledIds = Array.isArray(plan.blocks) ? plan.blocks.filter(Boolean) : [];
  if (enabledIds.length > 0) {
    const registry = blocksForTask(taskType);
    // Метки включённых блоков в заданном пользователем порядке.
    const labelById = new Map(registry.map((b) => [b.id, b.label]));
    const orderedLabels = enabledIds
      .map((id) => labelById.get(id))
      .filter((label): label is string => Boolean(label));
    const enabledSet = new Set(enabledIds);
    const excludedLabels = registry
      .filter((b) => !enabledSet.has(b.id))
      .map((b) => b.label);

    if (orderedLabels.length > 0) {
      lines.push(
        `СОСТАВ И ПОРЯДОК МАТЕРИАЛА (выбор руководителя, СТРОГО соблюдай). Сформируй ТОЛЬКО эти блоки и именно в этом порядке: ${orderedLabels
          .map((l, i) => `${i + 1}) ${l}`)
          .join("; ")}.`,
      );
      if (excludedLabels.length > 0) {
        lines.push(
          `НЕ выводи и не раскрывай следующие блоки (руководитель их отключил): ${excludedLabels.join(
            ", ",
          )}. Их отсутствие — намеренное, а не ошибка.`,
        );
      }
    }
  }

  if (volume) lines.push(VOLUME_DIRECTIVE[volume]);
  return lines.join("\n");
}
