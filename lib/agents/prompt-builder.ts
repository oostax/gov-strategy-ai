import type { ActionType } from "@/lib/schemas/agent";
import type { AgentOutput } from "@/lib/schemas/output";
import type { Playbook } from "@/lib/schemas/playbook";
import type { RegionProfile } from "@/lib/schemas/region";
import {
  outcomeLabels,
  relationshipLabels,
  stageLabels,
} from "@/lib/schemas/region";
import type { SessionProfile } from "@/lib/schemas/session";
import { roleLabels, taskLabels } from "@/lib/schemas/session";

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
import { actionPromptMap } from "@/lib/prompts/action-prompts";
import { analystModePrompt } from "@/lib/prompts/analyst-mode";
import { baseSystemPrompt } from "@/lib/prompts/base-system";
import { executiveModePrompt } from "@/lib/prompts/executive-mode";
import { salesRegionModePrompt } from "@/lib/prompts/sales-region-mode";
import { regionAnalysisModePrompt } from "@/lib/prompts/region-analysis-mode";
import { strategyModePrompt } from "@/lib/prompts/strategy-mode";

const agentOutputJsonContract = `Верни только валидный JSON без markdown fences и пояснений. Все видимые пользователю поля должны быть на русском языке.
Схема:
{
  "id": "",
  "sessionId": "",
  "title": "строка",
  "type": "строка",
  "summary": "строка",
  "sections": [
    {
      "id": "sec_1",
      "title": "Краткое резюме",
      "content": "строка",
      "type": "text"
    }
  ],
  "recommendations": ["строка"],
  "risks": ["строка"],
  "nextSteps": ["строка"],
  "markdown": "строка",
  "createdAt": "",
  "sources": [
    {
      "title": "Вводные сессии",
      "type": "session_input",
      "excerpt": "что именно использовано",
      "status": "used"
    },
    {
      "title": "Источник для проверки",
      "type": "external_required",
      "excerpt": "какой факт нужно проверить и где",
      "status": "needs_check",
      "url": "https://..."
    }
  ]
}
Допустимые section.type: "text", "table", "roadmap", "risks", "metrics", "actions".
Допустимые sources.type: "session_input", "playbook", "memory", "external_required".
Допустимые sources.status: "used", "needs_check".
В sections обязательно включи разделы:
- "Как Сбер может помочь"
- "Что является гипотезой"
- "Что нужно проверить источниками"
Не выдавай неподтвержденные региональные факты за достоверные. Если внешние источники не предоставлены, явно помечай такие утверждения как гипотезы.
Не называй конкретные продукты, суммы, законы, рейтинги и статистику как факт без источника; добавляй их в sources со статусом "needs_check".`;

// ── Региональный контекст ────────────────────────────────────────────────────

/**
 * Формирует блок регионального и внутрисберовского контекста.
 * Регион — это фон, а не авторитетный источник: любое утверждение
 * из этого блока модель обязана либо подтвердить источниками, либо
 * помечать как гипотезу.
 */
export function formatRegionContext(region: RegionProfile | null | undefined): string {
  if (!region) {
    return "Региональный контекст не загружен. Делай выводы осторожно и помечай региональные утверждения как гипотезы, требующие проверки.";
  }
  // Заглушки-плейсхолдеры («…(заполнить)», «заполнить») не должны попадать в
  // промпт как факты — отбрасываем их.
  const real = (value?: string | null): string | undefined => {
    const v = value?.trim();
    if (!v || /заполнить/i.test(v)) return undefined;
    return v;
  };

  const lines: string[] = [];
  lines.push(`# Региональный контекст: ${region.name}`);
  if (region.federalDistrict) lines.push(`Федеральный округ: ${region.federalDistrict}`);
  if (region.population) lines.push(`Население: ${region.population}`);
  if (region.digitalMaturity) {
    const note = region.digitalMaturityNote ? ` — ${region.digitalMaturityNote}` : "";
    lines.push(`Цифровая зрелость: ${region.digitalMaturity}/5${note}`);
  }
  if (region.budgetProfile) lines.push(`Бюджет региона: ${region.budgetProfile}`);
  if (region.budgetCycle) lines.push(`Бюджетный цикл: ${region.budgetCycle}`);
  if (region.topPriorities?.length) {
    lines.push("Стратегические приоритеты региона:");
    for (const priority of region.topPriorities) {
      const src = priority.source ? ` (источник: ${priority.source})` : "";
      lines.push(`- ${priority.title}${src}`);
    }
  }
  if (region.federalProjects?.length) {
    lines.push(`Активные федеральные проекты: ${region.federalProjects.join("; ")}`);
  }
  if (region.painPoints?.length) {
    lines.push("Известные боли и узкие места:");
    region.painPoints.forEach((point) => lines.push(`- ${point}`));
  }
  if (region.stakeholders?.length) {
    lines.push("Карта ЛПР (для использования в логике; ФИО, где 'уточняется', подавать как заполнитель):");
    for (const person of region.stakeholders.slice(0, 6)) {
      const rel = person.relationship ? `, отношения: ${relationshipLabels[person.relationship]}` : "";
      const motive = person.motivation ? ` · мотив: ${person.motivation}` : "";
      const flags = person.redFlags ? ` · красные флаги: ${person.redFlags}` : "";
      lines.push(`- ${person.fullName} — ${person.role}${person.department ? `, ${person.department}` : ""}${rel}${motive}${flags}`);
    }
  }
  if (region.news?.length) {
    lines.push("Свежая региональная повестка:");
    region.news.slice(0, 5).forEach((n) => {
      const src = n.source ? ` [${n.source}]` : "";
      const url = n.url ? ` ${n.url}` : "";
      lines.push(`- ${n.title}${src}${url}`);
    });
  }

  lines.push("");
  lines.push(`# Портфель Сбера в регионе`);
  if (real(region.keyAccountManager)) lines.push(`Key-account Сбера: ${real(region.keyAccountManager)}`);
  if (real(region.relationshipManager)) lines.push(`RM блока Госсектор: ${real(region.relationshipManager)}`);
  if (region.relevantProducts?.length) {
    lines.push(`Релевантные продукты Сбера: ${region.relevantProducts.join(", ")}`);
  }
  if (region.quarterlyPriorities?.length) {
    lines.push("Приоритеты блока на квартал:");
    region.quarterlyPriorities.forEach((item) => lines.push(`- ${item}`));
  }
  if (region.activeProjects?.length) {
    lines.push("Активные проекты Сбера в регионе (используй их как основу для 'Как Сбер может помочь'):");
    for (const project of region.activeProjects) {
      const amt = real(project.amount) ? `, ${real(project.amount)}` : "";
      const owner = real(project.sberOwner) ? `, владелец: ${real(project.sberOwner)}` : "";
      lines.push(`- ${project.product} — ${project.title} (${stageLabels[project.stage]}${amt}${owner})${project.notes ? ` · ${project.notes}` : ""}`);
    }
  }
  if (region.pastEngagements?.length) {
    lines.push("История взаимодействий (НЕ предлагать снова то, что было отклонено, без нового основания):");
    for (const engagement of region.pastEngagements) {
      const reason = engagement.reason ? ` — ${engagement.reason}` : "";
      lines.push(`- ${engagement.topic}: ${outcomeLabels[engagement.outcome]}${reason}`);
    }
  }
  if (region.sberNote) lines.push(`Заметка по заходу: ${region.sberNote}`);

  // Черновик из открытых источников — НЕ подтверждён человеком. Подаём строго
  // как гипотезы, чтобы модель не выдавала это за факты.
  const draft = region.draft;
  if (
    draft &&
    (draft.topPriorities.length ||
      draft.painPoints.length ||
      draft.news.length ||
      draft.stakeholders.length)
  ) {
    lines.push("");
    lines.push(
      "# ЧЕРНОВИК из открытых источников (НЕ подтверждён человеком — считать ГИПОТЕЗОЙ, не выдавать за факт; полезно для направления и вопросов на проверку):",
    );
    if (draft.topPriorities.length) {
      lines.push("Возможные приоритеты (требуют подтверждения):");
      draft.topPriorities.forEach((p) =>
        lines.push(`- [черновик] ${p.title}${p.source ? ` (источник: ${p.source})` : ""}`),
      );
    }
    if (draft.painPoints.length) {
      lines.push("Возможные боли/узкие места (требуют подтверждения):");
      draft.painPoints.forEach((p) => lines.push(`- [черновик] ${p}`));
    }
    if (draft.stakeholders.length) {
      lines.push("Возможные ЛПР (ФИО и роль требуют подтверждения, не выдавать за факт):");
      draft.stakeholders.forEach((s) =>
        lines.push(`- [черновик] ${s.fullName} — ${s.role}${s.department ? `, ${s.department}` : ""}`),
      );
    }
    if (draft.news.length) {
      lines.push("Возможная свежая повестка (требует подтверждения):");
      draft.news.slice(0, 5).forEach((n) =>
        lines.push(`- [черновик] ${n.title}${n.source ? ` [${n.source}]` : ""}`),
      );
    }
  }

  lines.push("");
  lines.push("Правило: используй эти данные для релевантности, но помечай как гипотезу всё, что не подтверждено открытым источником. Элементы с пометкой [черновик] — это неподтверждённые предположения, их нельзя выдавать за факты.");
  return lines.join("\n");
}

export function modePrompt(profile: SessionProfile) {
  if (profile.userRole === "vice_president") return executiveModePrompt;
  if (profile.taskType === "region_strategy") return regionAnalysisModePrompt;
  if (profile.userRole === "sales_lead") return salesRegionModePrompt;
  if (profile.userRole === "analyst") return analystModePrompt;
  if (profile.userRole === "product_lead") {
    return "Стиль: продуктовая стратегия. Покажи гипотезу, MVP, пользователей, эффект, метрики и критерии продолжать/остановить.";
  }
  if (profile.userRole === "project_office") {
    return "Стиль: проектный офис. Покажи этапы, владельцев, зависимости, контрольные точки и риски исполнения.";
  }
  return strategyModePrompt;
}

export function selectRelevantPlaybooks(profile: SessionProfile, playbooks: Playbook[]) {
  const slugs = new Set<string>();
  if (profile.userRole === "vice_president") slugs.add("executive_mode");
  if (profile.userRole === "direction_head") slugs.add("strategy_mode");
  if (profile.userRole === "sales_lead") slugs.add("sales_region_mode");
  if (profile.userRole === "analyst") slugs.add("analyst_mode");
  if (profile.taskType === "region_strategy") slugs.add("sales_region_mode");
  const topic = `${profile.focusTopic ?? ""} ${profile.region ?? ""}`.toLowerCase();
  for (const playbook of playbooks) {
    if (topic.includes("жкх") && playbook.slug === "digital_jkh") slugs.add(playbook.slug);
    if (topic.includes("бюдж") && playbook.slug === "budget_efficiency") slugs.add(playbook.slug);
    if (topic.includes("данн") && playbook.slug === "region_data_platform") slugs.add(playbook.slug);
    if (topic.includes("обращ") && playbook.slug === "citizen_appeals") slugs.add(playbook.slug);
  }
  return playbooks.filter((playbook) => slugs.has(playbook.slug)).slice(0, 4);
}

export function buildGenerationMessages(
  profile: SessionProfile,
  activePlaybooks: Playbook[],
  userPrompt = "",
  region: RegionProfile | null = null,
) {
  return [
    {
      role: "system" as const,
      content: `${baseSystemPrompt}\n\n${modePrompt(profile)}\n\n${agentOutputJsonContract}`,
    },
    {
      role: "user" as const,
      content: [
        `Профиль сессии:`,
        `Роль автора: ${roleLabels[profile.userRole]}`,
        `Тип материала: ${taskLabels[profile.taskType]}`,
        `Аудитория (кому предназначен материал): ${profile.audience}`,
        `Горизонт планирования: ${horizonLabels[profile.horizon] ?? profile.horizon}`,
        `Регион: ${profile.region || "не указан (федеральный уровень)"}`,
        `Задача / вопрос: ${profile.focusTopic || "не указан"}`,
        ``,
        `Инструкция по глубине: ${detailLevelInstructions[profile.detailLevel] ?? profile.detailLevel}`,
        `Инструкция по формату: ${outputFormatInstructions[profile.outputFormat] ?? profile.outputFormat}`,
        `Дополнительные требования: ${profile.constraints.length ? profile.constraints.join("; ") : "нет"}`,
        ``,
        formatRegionContext(region),
        ``,
        `Проверяемость: используй только вводные сессии, правила и региональный контекст. Актуальные внешние данные не выдумывай; сформулируй список источников, которые нужно проверить.`,
        `Активные правила:\n${activePlaybooks
          .map((item) => `## ${item.name}\n${item.rules.map((rule) => `- ${rule}`).join("\n")}`)
          .join("\n\n")}`,
        `Запрос пользователя: ${userPrompt || profile.focusTopic || "Сформируй стратегический материал"}`,
      ].join("\n"),
    },
  ];
}

export function buildActionMessages(
  profile: SessionProfile,
  activePlaybooks: Playbook[],
  actionType: ActionType,
  output: AgentOutput,
  webEvidence = "",
  region: RegionProfile | null = null,
) {
  return [
    {
      role: "system" as const,
      content: `${baseSystemPrompt}\n\n${modePrompt(profile)}\n\n${agentOutputJsonContract}`,
    },
    {
      role: "user" as const,
      content: [
        `Действие: ${actionPromptMap[actionType]}`,
        `Сохрани разделы "Как Сбер может помочь", "Что является гипотезой", "Что нужно проверить источниками".`,
        `Строго: не предлагай сокращение штата, не пиши SLA > X%, экономия X% или иные точные эффекты без официального источника. Если данных нет, пиши "baseline нужно снять".`,
        `Для руководителя используй структуру управленческой записки: решение, доказательства, факты/гипотезы, экономика через формулы, роль Сбера, критерий продолжать/остановить, следующий шаг.`,
        `Профиль сессии: ${JSON.stringify(profile, null, 2)}`,
        formatRegionContext(region),
        `Активные правила: ${activePlaybooks.map((item) => `${item.name}: ${item.rules.join("; ")}`).join("\n")}`,
        `Открытые источники для проверки и опоры:\n${webEvidence || "Источники не найдены за время поиска. Не выдумывай факты."}`,
        `Текущий AgentOutput JSON: ${JSON.stringify(output, null, 2)}`,
      ].join("\n\n"),
    },
  ];
}
