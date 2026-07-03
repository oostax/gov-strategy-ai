"use client";

import { useEffect, useState } from "react";
import { Lightbulb, X } from "lucide-react";
import type { TypedOutput } from "@/lib/schemas/structured-output";

const STORAGE_KEY = "gsa-exec-hints-dismissed";

const hintsByKind: Record<TypedOutput["kind"], string[]> = {
  strategy: [
    "Порядок просмотра: вердикт (рекомендуем / условно / нет), далее экономика — эффект и срок окупаемости.",
    "Матрица ставок: верхний правый квадрант — высокий эффект при низкой сложности реализации.",
    "Отметка «базовая линия не подтверждена» означает недостаток данных для утверждения цифры.",
    "Оценка материала обновляет правила генерации последующих материалов.",
  ],
  meeting: [
    "Колонка «Фиксируем» в сценарии указывает, что требуется закрепить по каждому блоку встречи.",
    "Блок «После встречи» содержит шаги для каждого исхода: согласие, пауза, отказ.",
    "Оценка материала используется для настройки сценария под стиль пользователя.",
  ],
  brief: [
    "Решение указано первым абзацем. Экономика разбита на множители для проверки источника эффекта.",
    "Указан один следующий шаг с ответственным и сроком.",
    "Оценка материала учитывается при формировании последующих материалов.",
  ],
  region: [
    "Порядок просмотра: регион, отрасли, бюджет, приоритеты, сценарии, затем позиция Сбера.",
    "Отраслевая структура показывает основные драйверы и ограничения региона.",
    "Сценарии описывают альтернативные траектории развития региона.",
    "Недостающие факты вынесены в список вопросов, а не заменены допущениями.",
  ],
};

export function ExecutiveHints({ kind }: { kind: TypedOutput["kind"] }) {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY) !== "1") {
      const t = window.setTimeout(() => setDismissed(false), 0);
      return () => window.clearTimeout(t);
    }
  }, []);

  if (dismissed) return null;

  const hints = hintsByKind[kind] ?? hintsByKind.strategy;

  return (
    <div className="rounded-2xl border border-amber-300/40 bg-amber-50/40 p-4 dark:border-amber-900/40 dark:bg-amber-950/20">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-200">
          <Lightbulb className="size-4" /> Как читать материал
        </p>
        <button
          type="button"
          onClick={() => {
            localStorage.setItem(STORAGE_KEY, "1");
            setDismissed(true);
          }}
          className="rounded-md p-1 text-amber-700/70 transition hover:bg-amber-100 hover:text-amber-900 dark:text-amber-300/70 dark:hover:bg-amber-900/40"
          aria-label="Скрыть подсказки"
        >
          <X className="size-4" />
        </button>
      </div>
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {hints.map((hint, idx) => (
          <li key={idx} className="flex items-start gap-2 text-xs leading-snug text-amber-900/90 dark:text-amber-100/90">
            <span className="mt-1 size-1.5 shrink-0 rounded-full bg-amber-500" />
            {hint}
          </li>
        ))}
      </ul>
    </div>
  );
}
