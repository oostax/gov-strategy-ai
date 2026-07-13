"use client";

import { Lightbulb } from "lucide-react";
import type { TypedOutput } from "@/lib/schemas/structured-output";

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
  const hints = hintsByKind[kind] ?? hintsByKind.strategy;

  return (
    <details className="rounded-xl border bg-muted/20 px-3 py-2">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-muted-foreground">
        <Lightbulb className="size-3.5" /> Как читать материал
      </summary>
      <ul className="mt-2 grid gap-1.5 border-t pt-2 sm:grid-cols-2">
        {hints.map((hint, idx) => (
          <li key={idx} className="flex items-start gap-2 text-xs leading-snug text-muted-foreground">
            <span className="mt-1 size-1.5 shrink-0 rounded-full bg-foreground/30" />
            {hint}
          </li>
        ))}
      </ul>
    </details>
  );
}
