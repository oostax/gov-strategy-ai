"use client";

import { useState } from "react";
import {
  ArrowRight,
  Brain,
  CheckCircle2,
  Clock,
  FileText,
  MapPin,
  MessageSquare,
  Mic,
  Shield,
  Sparkles,
  XCircle,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "gov-strategy-ai-onboarded";

export function useOnboarding() {
  const [seen, setSeen] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(STORAGE_KEY) === "1";
  });

  function complete() {
    localStorage.setItem(STORAGE_KEY, "1");
    setSeen(true);
  }

  return { seen, complete };
}

// ── Slides ───────────────────────────────────────────────────────────────────

interface Slide {
  title: string;
  sub: string;
  items: Array<{
    icon: React.ComponentType<{ className?: string }>;
    text: string;
    accent?: boolean;
  }>;
}

const slides: Slide[] = [
  {
    title: "О системе",
    sub: "Стратегический ИИ-штаб для руководителя департамента по работе с госсектором",
    items: [
      { icon: Sparkles, text: "Готовит материалы к встречам, позиции для ВП, стратегии по регионам" },
      { icon: Brain, text: "Учится на ваших оценках — каждая оценка улучшает следующий ответ" },
      { icon: MapPin, text: "Знает ваши регионы, ЛПР, портфель Сбера и историю взаимодействий" },
      { icon: Mic, text: "Принимает задачу голосом — достаточно сформулировать её одной фразой" },
    ],
  },
  {
    title: "Возможности",
    sub: "7 типов материалов, каждый со своей структурой",
    items: [
      { icon: MessageSquare, text: "Подготовка встречи — сценарий по минутам, возражения, 3 исхода" },
      { icon: FileText, text: "Позиция для ВП — 1 страница: решение → факты → следующий шаг" },
      { icon: MapPin, text: "Стратегия Сбера в регионе — портфель, ЛПР, план захода, продукты" },
      { icon: Zap, text: "Выбор направления — 3 ставки с go/no-go и конкретным продуктом Сбера" },
      { icon: Clock, text: "Сценарии — 3 варианта развития с триггерами и позицией Сбера" },
    ],
  },
  {
    title: "Ограничения",
    sub: "О границах применения — чтобы избежать ложных ожиданий",
    items: [
      { icon: XCircle, text: "Не заменяет ваше решение — даёт структуру и факты, решаете вы", accent: true },
      { icon: XCircle, text: "Не выдумывает цифры — если данных нет, указывает «требуется снять базовую линию»", accent: true },
      { icon: XCircle, text: "Не знает закрытую информацию — работает с тем, что вы внесли в регионы", accent: true },
      { icon: XCircle, text: "Не отправляет письма и не звонит — готовит материал, действуете вы", accent: true },
      { icon: Shield, text: "Все данные хранятся локально, ничего не уходит третьим сторонам" },
    ],
  },
  {
    title: "Как начать?",
    sub: "3 шага до первого результата",
    items: [
      { icon: CheckCircle2, text: "1. Нажмите «Создать сессию» и сформулируйте задачу голосом или текстом" },
      { icon: CheckCircle2, text: "2. Проверьте тип материала и регион — агент подберёт контекст" },
      { icon: CheckCircle2, text: "3. Получите результат за 2 минуты — оцените его, и агент станет точнее" },
    ],
  },
];

// ── Component ────────────────────────────────────────────────────────────────

export function OnboardingScreen({ onComplete }: { onComplete: () => void }) {
  const [current, setCurrent] = useState(0);
  const slide = slides[current];
  const isLast = current === slides.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm">
      <div className="w-full max-w-lg animate-in fade-in zoom-in-95 duration-300">
        {/* Card */}
        <div className="rounded-3xl border bg-card p-6 shadow-2xl sm:p-8">
          {/* Header */}
          <div className="mb-6 text-center">
            <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
              <Sparkles className="size-6" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">{slide.title}</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {slide.sub}
            </p>
          </div>

          {/* Items */}
          <div className="mb-8 space-y-3">
            {slide.items.map((item, idx) => (
              <div
                key={idx}
                className={cn(
                  "flex items-start gap-3 rounded-xl border p-3 transition animate-in fade-in slide-in-from-left-2",
                  item.accent
                    ? "border-destructive/20 bg-destructive/5"
                    : "bg-muted/30",
                )}
                style={{ animationDelay: `${idx * 80}ms` }}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg",
                    item.accent
                      ? "bg-destructive/10 text-destructive"
                      : "bg-primary/10 text-primary",
                  )}
                >
                  <item.icon className="size-3.5" />
                </span>
                <p className="text-sm leading-snug">{item.text}</p>
              </div>
            ))}
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between gap-3">
            {/* Dots */}
            <div className="flex gap-1.5">
              {slides.map((_, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setCurrent(idx)}
                  className={cn(
                    "size-2 rounded-full transition-all",
                    idx === current
                      ? "w-6 bg-primary"
                      : "bg-muted-foreground/20 hover:bg-muted-foreground/40",
                  )}
                />
              ))}
            </div>

            {/* Buttons */}
            <div className="flex gap-2">
              {!isLast && (
                <Button variant="ghost" size="sm" onClick={onComplete}>
                  Пропустить
                </Button>
              )}
              {isLast ? (
                <Button onClick={onComplete}>
                  Начать работу <ArrowRight className="size-4" />
                </Button>
              ) : (
                <Button onClick={() => setCurrent((c) => c + 1)}>
                  Далее <ArrowRight className="size-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
