"use client";

import { useEffect, useState } from "react";
import { Lightbulb, X } from "lucide-react";
import type { TypedOutput } from "@/lib/schemas/structured-output";

const STORAGE_KEY = "gsa-exec-hints-dismissed";

const hintsByKind: Record<TypedOutput["kind"], string[]> = {
  strategy: [
    "Начните сверху: вердикт (рекомендуем / условно / нет) и экономика — деньги и срок окупаемости.",
    "Матрица ставок: правый-верхний угол — «быстрые победы» (высокий эффект, легко реализовать).",
    "Жёлтое «baseline не снят» — там не хватает данных, чтобы подписаться под цифрой.",
    "Оцените материал внизу — агент учится на вашей оценке и обновляет правила.",
  ],
  meeting: [
    "Колонка «Фиксируем» в сценарии — что именно нужно закрепить по каждому блоку встречи.",
    "Блок «После встречи» — готовые шаги под каждый исход: согласие, пауза, отказ.",
    "Оцените материал внизу — агент улучшит сценарий под ваш стиль.",
  ],
  brief: [
    "Решение — первым абзацем. Экономика разобрана на множители: видно, из чего эффект.",
    "Один следующий шаг — то, что нужно сделать сразу, с владельцем и сроком.",
    "Оцените материал внизу — агент учится на вашей оценке.",
  ],
  region: [
    "Читайте сверху вниз: регион → отрасли → бюджет → приоритеты → сценарии → только потом Сбер.",
    "Отраслевая структура показывает, где у региона реальные драйверы и ограничения.",
    "Сценарии — это разные траектории региона, а не варианты одного пилота.",
    "Что проверить: недостающие факты лучше вынести в список вопросов, чем маскировать допущениями.",
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
