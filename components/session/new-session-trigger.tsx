"use client";

import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";

export function NewSessionTrigger() {
  return (
    <Link href="/sessions/new">
      <div className="group flex w-full cursor-pointer items-center gap-4 rounded-3xl border border-primary bg-primary p-5 text-left transition hover:bg-primary/90 hover:shadow-md">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary-foreground text-primary">
          <Plus className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold text-primary-foreground">Подготовить материал</p>
          <p className="mt-1 text-sm text-primary-foreground/70">
            Опишите задачу одной фразой. Система определит тип, регион и состав материала.
          </p>
        </div>
        <ChevronRight className="size-4 shrink-0 text-primary-foreground/70 transition group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}

export function EmptySessionsTrigger() {
  return (
    <Link
      href="/sessions/new"
      className="mt-3 inline-block text-sm font-medium underline underline-offset-4 hover:no-underline"
    >
      Создать первую сессию →
    </Link>
  );
}
