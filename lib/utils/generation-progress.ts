import { promises as fs } from "fs";
import path from "path";

export interface GenerationProgress {
  step: string;
  message: string;
  startedAt: string;
  /** 0-100 estimate */
  percent?: number;
}

function progressDir(): Promise<string> {
  const dir = path.join(
    process.env.DATA_DIR || path.join(process.cwd(), "data"),
    "structured",
    "progress",
  );
  return fs.mkdir(dir, { recursive: true }).then(() => dir);
}

export async function writeProgress(
  sessionId: string,
  step: string,
  message: string,
  percent?: number,
): Promise<void> {
  try {
    const dir = await progressDir();
    const data: GenerationProgress = {
      step,
      message,
      startedAt: new Date().toISOString(),
      percent,
    };
    await fs.writeFile(
      path.join(dir, `${sessionId}.json`),
      JSON.stringify(data),
    );
  } catch {
    // Best effort
  }
}

export async function readProgress(
  sessionId: string,
): Promise<GenerationProgress | null> {
  try {
    const dir = await progressDir();
    const raw = await fs.readFile(path.join(dir, `${sessionId}.json`), "utf8");
    return JSON.parse(raw) as GenerationProgress;
  } catch {
    return null;
  }
}

export async function clearProgress(sessionId: string): Promise<void> {
  try {
    const dir = await progressDir();
    await fs.unlink(path.join(dir, `${sessionId}.json`));
  } catch {
    // Best effort
  }
}

export const GENERATION_STEPS: Record<string, { label: string; weight: number }> = {
  storage: { label: "Загрузка сессии", weight: 1 },
  playbooks: { label: "Подбор правил", weight: 1 },
  region_context: { label: "Чтение контекста региона", weight: 2 },
  memory_search: { label: "Поиск в MemPalace", weight: 3 },
  web_research: { label: "Поиск открытых источников", weight: 10 },
  evidence_pack: { label: "Извлечение фактов", weight: 8 },
  llm_generate: { label: "Генерация анализа", weight: 25 },
  shape_repair: { label: "Проверка формы", weight: 5 },
  llm_review: { label: "Ревизия качества", weight: 20 },
  shape_repair2: { label: "Финальная проверка", weight: 5 },
  guard_sources: { label: "Привязка источников", weight: 5 },
  assembly: { label: "Сборка результата", weight: 3 },
  save: { label: "Сохранение", weight: 2 },
  done: { label: "Готово", weight: 0 },
};
