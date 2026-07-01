import { promises as fs } from "fs";
import path from "path";
import { createId, createToken } from "@/lib/utils/ids";
import { nowIso } from "@/lib/utils/dates";
import type { Feedback } from "@/lib/schemas/feedback";
import type { AgentOutput } from "@/lib/schemas/output";
import type { Playbook, UpdatePlaybookInput } from "@/lib/schemas/playbook";
import type {
  CreateRegionInput,
  RegionProfile,
  UpdateRegionInput,
} from "@/lib/schemas/region";
import type { SessionProfile } from "@/lib/schemas/session";
import type { EvolutionRecord, StorageAdapter } from "./storage";
import { regionSeed } from "./region-seed";
import {
  sberGovProjects,
  type CreateSberGovProjectInput,
  type SberGovProject,
  type UpdateSberGovProjectInput,
} from "./sber-projects";

const dataRoot = process.env.DATA_DIR || path.join(process.cwd(), "data");

// ── Mutex for concurrent access safety ──────────────────────────────────────
let storeLock = false;
const lockQueue: Array<() => void> = [];

async function acquireLock(): Promise<void> {
  if (!storeLock) {
    storeLock = true;
    return;
  }
  return new Promise<void>((resolve) => {
    lockQueue.push(resolve);
  });
}

function releaseLock(): void {
  if (lockQueue.length > 0) {
    const next = lockQueue.shift()!;
    next();
  } else {
    storeLock = false;
  }
}

interface StoreShape {
  sessions: SessionProfile[];
  outputs: AgentOutput[];
  feedback: Feedback[];
  evolution: EvolutionRecord[];
  playbooks: Playbook[];
  regions: RegionProfile[];
  sberCatalog: SberGovProject[];
}

const playbookSeed: Array<Omit<Playbook, "updatedAt" | "history">> = [
  {
    id: "pb_executive_mode",
    name: "Режим руководителя",
    slug: "executive_mode",
    description: "Короткие управленческие материалы для ВП и правления.",
    rules: [
      "Начинай с решения, ставки и управленческого вывода — не с контекста.",
      "Показывай экономический эффект через формулу, а не процент без источника.",
      "Указывай риск бездействия: что произойдёт если не действовать.",
      "Следующий шаг должен быть конкретным: кто, что, до какой даты.",
      "Убирай технические детали, если они не влияют на решение.",
      "Объём: не более 1 экрана для краткой записки, 2-3 для стратегии.",
    ],
    template: "Решение → Почему сейчас → Что делает Сбер → Следующий шаг",
    version: 1,
  },
  {
    id: "pb_strategy_mode",
    name: "Стратегический режим",
    slug: "strategy_mode",
    description: "Стратегические сессии для руководителей направлений.",
    rules: [
      "Разделяй гипотезы, доказательства и управленческие решения явно.",
      "Давай 2-3 опции с критериями выбора — не одну 'правильную' ставку.",
      "Связывай инициативы с ресурсами, горизонтом и метриками.",
      "Для каждой опции: управленческая логика, что нужно проверить, критерий go/no-go.",
      "Не используй слова 'повысить эффективность' без механизма эффекта.",
      "Рассматривай процессные, финансовые, партнёрские и технологические варианты.",
    ],
    template: "Контекст → Опции → Рекомендуемая ставка → Дорожная карта → Метрики → Риски",
    version: 1,
  },
  {
    id: "pb_sales_region_mode",
    name: "Региональные продажи",
    slug: "sales_region_mode",
    description: "Региональные заходы, ЛПР, ценность для субъекта и продажи.",
    rules: [
      "Стиль регионального анализа: серьёзный русский деловой язык; профессиональные сокращения ЛПР, ИТ, ВРП, ФО, млрд и млн допустимы.",
      "Не используй в материале разговорные слова, англицизмы, внутренние рабочие термины и заглушки вроде unknown, n/a, 'уточняется'.",
      "Не используй слова 'боль', 'мотив', 'заход', 'пробел'; заменяй на 'ограничение', 'управленческий интерес', 'практическое действие', 'что проверить'.",
      "Показывай карту ЛПР: Минфин, Минцифры, отраслевой заказчик — управленческий интерес каждого.",
      "Формулируй первое практическое действие без перегруза технологическими деталями.",
      "Указывай, где Сбер может дать быстрый эффект за 8 недель.",
      "Для каждого ЛПР: управленческий интерес, ограничение, нужный артефакт.",
      "Первое действие: конкретная встреча, конкретный вопрос, конкретный следующий шаг.",
      "Не обещай результаты без baseline — формулируй как гипотезу для проверки.",
    ],
    template: "Региональная гипотеза → ЛПР → Первое действие → MVP → Возражения",
    version: 1,
  },
  {
    id: "pb_analyst_mode",
    name: "Аналитический режим",
    slug: "analyst_mode",
    description: "Аналитические разборы, сценарии, риски и метрики.",
    rules: [
      "Отделяй известные факты от допущений — явно маркируй каждое.",
      "Для каждого вывода добавляй индикатор проверки: где взять данные.",
      "Если данных мало, формируй предварительную гипотезу и список данных для сбора.",
      "Сценарии: базовый, оптимистичный, пессимистичный — с триггерами перехода.",
      "Метрики: формула расчёта, источник данных, периодичность обновления.",
    ],
    template: "Данные → Допущения → Сценарии → Сигналы → Следующий анализ",
    version: 1,
  },
  {
    id: "pb_ai_government",
    name: "ИИ в госсекторе",
    slug: "ai_government",
    description: "ИИ в госсекторе: процессы, регуляторика, эффекты.",
    rules: [
      "Связывай ИИ-кейсы с качеством услуги, бюджетом и контролируемостью.",
      "ИИ — не цель, а инструмент. Сначала процессное решение, потом технология.",
      "Для каждого ИИ-кейса: правовой контур, данные, интеграции, пилотная зона.",
      "Не предлагай ИИ там, где достаточно регламента или финансового стимула.",
    ],
    template: "Кейс → Управление → Данные → Эффект → Риск",
    version: 1,
  },
  {
    id: "pb_citizen_appeals",
    name: "Обращения граждан",
    slug: "citizen_appeals",
    description: "Обращения граждан, контакт-центры, классификация и маршрутизация.",
    rules: [
      "Показывай снижение нагрузки операторов и повышение прозрачности — без выдуманных SLA.",
      "Классификация и маршрутизация обращений — не 'чат-боты'.",
      "Для пилота: пилотная зона, объём обращений, критерии остановки.",
    ],
    template: "Боль → Классификация/маршрутизация → Процесс → Метрики → Пилот",
    version: 1,
  },
  {
    id: "pb_digital_jkh",
    name: "Цифровое ЖКХ",
    slug: "digital_jkh",
    description: "Цифровизация ЖКХ и муниципальной инфраструктуры.",
    rules: [
      "Учитывай аварийность, платежную дисциплину, обращения и износ фондов.",
      "Данные ЖКХ: ГИС ЖКХ, региональные операторы, управляющие компании.",
      "Эффект через формулу: снижение аварийности × стоимость устранения аварии.",
    ],
    template: "Проблема → Платформа данных → Сервисы → Экономика → Риски",
    version: 1,
  },
  {
    id: "pb_budget_efficiency",
    name: "Бюджетная эффективность",
    slug: "budget_efficiency",
    description: "Бюджетная эффективность, контроль расходов и приоритизация.",
    rules: [
      "Для Минфина региона показывай прозрачность и контроль исполнения — не абстрактную экономию.",
      "Экономия только через формулу с источником данных, иначе — 'нужно снять базовую линию'.",
      "Связывай с бюджетным циклом: когда нужно принять решение для включения в бюджет.",
    ],
    template: "Бюджетное давление → Рычаги → Эффект → Контроль → Решение",
    version: 1,
  },
  {
    id: "pb_municipal_digitalization",
    name: "Муниципальная цифровизация",
    slug: "municipal_digitalization",
    description: "Муниципальная цифровизация и тиражируемые решения.",
    rules: [
      "Давай масштабируемый MVP, который можно пилотировать в 1-2 муниципалитетах.",
      "Тиражирование: что нужно для перехода от пилота к масштабу.",
      "Стейкхолдеры муниципального уровня: глава, финансовый директор, IT-директор.",
    ],
    template: "Муниципальная боль → MVP → Масштабирование → Стейкхолдеры → Метрики",
    version: 1,
  },
  {
    id: "pb_procurement_strategy",
    name: "Закупочная стратегия",
    slug: "procurement_strategy",
    description: "Закупочная стратегия и подготовка к конкурсным процедурам.",
    rules: [
      "Не предлагай обход закупочных процедур; фокусируйся на законной подготовке ценности.",
      "44-ФЗ и 223-ФЗ: разные процедуры, разные сроки, разные требования.",
      "Для пилота: какая процедура подходит, какие документы нужны, кто владелец.",
    ],
    template: "Потребность → Закупочный путь → Доказательство ценности → Риски → Следующий шаг",
    version: 1,
  },
  {
    id: "pb_region_data_platform",
    name: "Региональная платформа данных",
    slug: "region_data_platform",
    description: "Региональные платформы данных и межведомственные витрины.",
    rules: [
      "Показывай владельцев данных, качество данных, витрины и governance.",
      "Данные без governance — не платформа. Нужен владелец каждого домена.",
      "Интеграция с СМЭВ, ГАС 'Управление', региональными системами.",
    ],
    template: "Домены данных → Управление → MVP-витрины → Эффекты → Риски",
    version: 1,
  },
];

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson<T>(filePath: string, data: T) {
  await ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tempPath, filePath);
}

async function seedPlaybookMarkdown(playbooks: Playbook[]) {
  const dir = path.join(dataRoot, "playbooks");
  await ensureDir(dir);
  await Promise.all(
    playbooks.map((playbook) =>
      fs.writeFile(
        path.join(dir, `${playbook.slug}.md`),
        `# ${playbook.name}\n\n${playbook.description}\n\n## Rules\n${playbook.rules
          .map((rule) => `- ${rule}`)
          .join("\n")}\n\n## Template\n${playbook.template}\n`,
        "utf8",
      ),
    ),
  );
}

async function seedMemoryFiles() {
  const dir = path.join(dataRoot, "memory");
  await ensureDir(dir);
  const files: Record<string, string> = {
    "strategy_rules.md": "# Strategy Rules\n\n- Всегда связывать вывод с управленческим действием.\n",
    "feedback_log.md": "# Feedback Log\n\n",
    "successful_briefs.md": "# Successful Briefs\n\n",
    "failed_answers.md": "# Failed Answers\n\n",
    "prompt_versions.md": "# Prompt Versions\n\n- v1: базовый стратегический штаб.\n",
  };
  await Promise.all(
    Object.entries(files).map(async ([name, content]) => {
      const filePath = path.join(dir, name);
      try {
        await fs.access(filePath);
      } catch {
        await fs.writeFile(filePath, content, "utf8");
      }
    }),
  );
}

async function loadStore(): Promise<StoreShape> {
  await acquireLock();
  try {
    await ensureDir(dataRoot);
    const now = nowIso();
    const seededPlaybooks = playbookSeed.map((playbook) => ({
      ...playbook,
      updatedAt: now,
      history: [{ version: 1, change: "Initial MVP playbook seed", createdAt: now }],
    }));
    const store = await readJson<StoreShape>(path.join(dataRoot, "store.json"), {
      sessions: [],
      outputs: [],
      feedback: [],
      evolution: [],
      playbooks: seededPlaybooks,
      regions: [],
      sberCatalog: [],
    });
    if (store.playbooks.length === 0) store.playbooks = seededPlaybooks;
    if (!Array.isArray(store.regions)) store.regions = [];
    if (store.regions.length === 0) {
      store.regions = regionSeed.map((region) => ({
        ...region,
        createdAt: now,
        updatedAt: now,
      }));
    }
    if (!Array.isArray(store.sberCatalog)) store.sberCatalog = [];
    if (store.sberCatalog.length === 0) {
      store.sberCatalog = sberGovProjects.map((project) => ({ ...project }));
    }
    const seedBySlug = new Map(seededPlaybooks.map((playbook) => [playbook.slug, playbook]));
    store.playbooks = store.playbooks.map((playbook) => {
      const seed = seedBySlug.get(playbook.slug);
      return seed
        ? {
            ...playbook,
            name: seed.name,
            description: seed.description,
            template: playbook.template.includes("->") ? seed.template : playbook.template,
          }
        : playbook;
    });
    await seedPlaybookMarkdown(store.playbooks);
    await seedMemoryFiles();
    await writeJson(path.join(dataRoot, "store.json"), store);
    return store;
  } finally {
    releaseLock();
  }
}

async function saveStore(store: StoreShape) {
  await writeJson(path.join(dataRoot, "store.json"), store);
}

export function createLocalJsonStorage(): StorageAdapter {
  return {
    async createSession(input) {
      const store = await loadStore();
      const now = nowIso();
      const session: SessionProfile = {
        ...input,
        id: createId("ses"),
        createdAt: now,
        updatedAt: now,
      };
      store.sessions.unshift(session);
      await saveStore(store);
      return session;
    },
    async listSessions() {
      const store = await loadStore();
      return store.sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async getSession(id) {
      const store = await loadStore();
      const session = store.sessions.find((item) => item.id === id);
      if (!session) return null;
      return {
        session,
        outputs: store.outputs.filter((item) => item.sessionId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        feedback: store.feedback.filter((item) => item.sessionId === id),
        evolution: store.evolution.filter((item) => item.sessionId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      };
    },
    async updateSession(session) {
      const store = await loadStore();
      store.sessions = store.sessions.map((item) =>
        item.id === session.id ? { ...session, updatedAt: nowIso() } : item,
      );
      await saveStore(store);
      return store.sessions.find((item) => item.id === session.id) ?? session;
    },
    async renameSession(id, focusTopic) {
      const store = await loadStore();
      const existing = store.sessions.find((item) => item.id === id);
      if (!existing) throw new Error("Session not found");
      const renamed: SessionProfile = { ...existing, focusTopic, updatedAt: nowIso() };
      store.sessions = store.sessions.map((item) => (item.id === id ? renamed : item));
      await saveStore(store);
      return renamed;
    },
    async rotateShareToken(id, enable) {
      const store = await loadStore();
      const existing = store.sessions.find((item) => item.id === id);
      if (!existing) throw new Error("Session not found");
      const nextToken = enable ? createToken(24) : undefined;
      const next: SessionProfile = {
        ...existing,
        shareToken: nextToken,
        updatedAt: nowIso(),
      };
      store.sessions = store.sessions.map((item) => (item.id === id ? next : item));
      await saveStore(store);
      return next;
    },
    async getSessionByShareToken(token) {
      if (!token) return null;
      const store = await loadStore();
      const session = store.sessions.find((item) => item.shareToken === token);
      if (!session) return null;
      return {
        session,
        outputs: store.outputs
          .filter((item) => item.sessionId === session.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        feedback: [],
        evolution: [],
      };
    },
    async deleteSession(id) {
      const store = await loadStore();
      store.sessions = store.sessions.filter((item) => item.id !== id);
      store.outputs = store.outputs.filter((item) => item.sessionId !== id);
      store.feedback = store.feedback.filter((item) => item.sessionId !== id);
      store.evolution = store.evolution.filter((item) => item.sessionId !== id);
      await saveStore(store);
    },
    async saveOutput(output) {
      const store = await loadStore();
      store.outputs = [output, ...store.outputs.filter((item) => item.id !== output.id)];
      store.sessions = store.sessions.map((session) =>
        session.id === output.sessionId ? { ...session, updatedAt: nowIso() } : session,
      );
      await saveStore(store);
      return output;
    },
    async getOutput(id) {
      const store = await loadStore();
      return store.outputs.find((item) => item.id === id) ?? null;
    },
    async listOutputs(sessionId) {
      const store = await loadStore();
      return store.outputs.filter((item) => !sessionId || item.sessionId === sessionId);
    },
    async saveFeedback(feedback) {
      const store = await loadStore();
      store.feedback.unshift(feedback);
      await saveStore(store);
      return feedback;
    },
    async listFeedback(sessionId) {
      const store = await loadStore();
      return store.feedback.filter((item) => !sessionId || item.sessionId === sessionId);
    },
    async saveEvolution(record) {
      const store = await loadStore();
      store.evolution.unshift(record);
      await saveStore(store);
      return record;
    },
    async listEvolution(sessionId) {
      const store = await loadStore();
      return store.evolution.filter((item) => !sessionId || item.sessionId === sessionId);
    },
    async listPlaybooks() {
      const store = await loadStore();
      return store.playbooks;
    },
    async getPlaybook(idOrSlug) {
      const store = await loadStore();
      return store.playbooks.find((item) => item.id === idOrSlug || item.slug === idOrSlug) ?? null;
    },
    async updatePlaybook(idOrSlug, input: UpdatePlaybookInput, change: string, meta) {
      const store = await loadStore();
      const existing = store.playbooks.find((item) => item.id === idOrSlug || item.slug === idOrSlug);
      if (!existing) throw new Error("Playbook not found");
      const next: Playbook = {
        ...existing,
        ...input,
        version: existing.version + 1,
        updatedAt: nowIso(),
        history: [
          {
            version: existing.version + 1,
            change,
            createdAt: nowIso(),
            direction: meta?.direction ?? "manual",
            ...(meta?.rating !== undefined ? { rating: meta.rating } : {}),
            ...(meta?.sessionId ? { sessionId: meta.sessionId } : {}),
            ...(meta?.rule ? { rule: meta.rule } : {}),
          },
          ...existing.history,
        ],
      };
      store.playbooks = store.playbooks.map((item) => (item.id === existing.id ? next : item));
      await saveStore(store);
      await seedPlaybookMarkdown(store.playbooks);
      return next;
    },

    // ── Регионы ──────────────────────────────────────────────────────────
    async listRegions() {
      const store = await loadStore();
      return [...store.regions].sort((a, b) => a.name.localeCompare(b.name, "ru"));
    },
    async getRegion(idOrSlug: string) {
      const store = await loadStore();
      return (
        store.regions.find((item) => item.id === idOrSlug || item.slug === idOrSlug) ??
        null
      );
    },
    async createRegion(input: CreateRegionInput) {
      const store = await loadStore();
      const now = nowIso();
      const slug = input.slug.trim().toLowerCase();
      if (store.regions.some((item) => item.slug === slug)) {
        throw new Error("Регион с таким slug уже есть");
      }
      const region: RegionProfile = {
        ...input,
        id: createId("reg"),
        slug,
        createdAt: now,
        updatedAt: now,
      };
      store.regions.push(region);
      await saveStore(store);
      return region;
    },
    async updateRegion(idOrSlug: string, input: UpdateRegionInput) {
      const store = await loadStore();
      const existing = store.regions.find(
        (item) => item.id === idOrSlug || item.slug === idOrSlug,
      );
      if (!existing) throw new Error("Регион не найден");
      const next: RegionProfile = {
        ...existing,
        ...input,
        id: existing.id,
        slug: input.slug ? input.slug.trim().toLowerCase() : existing.slug,
        updatedAt: nowIso(),
      };
      store.regions = store.regions.map((item) =>
        item.id === existing.id ? next : item,
      );
      await saveStore(store);
      return next;
    },
    async deleteRegion(idOrSlug: string) {
      const store = await loadStore();
      store.regions = store.regions.filter(
        (item) => item.id !== idOrSlug && item.slug !== idOrSlug,
      );
      await saveStore(store);
    },

    // ── Каталог проектов Сбера ───────────────────────────────────────────
    async listSberCatalog() {
      const store = await loadStore();
      return store.sberCatalog;
    },
    async createSberCatalogProject(input: CreateSberGovProjectInput) {
      const store = await loadStore();
      const project: SberGovProject = { ...input, id: createId("sgp") };
      store.sberCatalog.unshift(project);
      await saveStore(store);
      return project;
    },
    async updateSberCatalogProject(id: string, input: UpdateSberGovProjectInput) {
      const store = await loadStore();
      const existing = store.sberCatalog.find((item) => item.id === id);
      if (!existing) throw new Error("Проект каталога не найден");
      // Применяем только определённые поля, чтобы частичный PATCH не затирал данные undefined.
      const defined = Object.fromEntries(
        Object.entries(input).filter(([, value]) => value !== undefined),
      );
      const next: SberGovProject = { ...existing, ...defined, id: existing.id };
      store.sberCatalog = store.sberCatalog.map((item) => (item.id === id ? next : item));
      await saveStore(store);
      return next;
    },
    async deleteSberCatalogProject(id: string) {
      const store = await loadStore();
      store.sberCatalog = store.sberCatalog.filter((item) => item.id !== id);
      await saveStore(store);
    },
  };
}

let storage: StorageAdapter | null = null;

export function getStorage() {
  storage ??= createLocalJsonStorage();
  return storage;
}
