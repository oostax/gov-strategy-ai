"use client";

import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Building2,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Compass,
  FileText,
  Flag,
  MapPin,
  MessageSquare,
  Route,
  ShieldCheck,
  Target,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  taskLabels,
  urgencyLabels,
  type SessionProfile,
} from "@/lib/schemas/session";
import type {
  BriefOutput,
  MeetingOutput,
  RegionAnalysisOutput,
  StructuredOutput,
  TypedOutput,
} from "@/lib/schemas/structured-output";
import { cn } from "@/lib/utils";

export function SessionFocusBar({
  id,
  session,
  output,
}: {
  id?: string;
  session: SessionProfile;
  output: TypedOutput;
}) {
  const focus = getFocus(output);
  const sections = getSections(output);

  return (
    <div
      id={id}
      className="static rounded-2xl border bg-card p-3 shadow-sm"
    >
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary">{taskLabels[session.taskType]}</Badge>
            {session.region && (
              <Badge variant="outline">
                <MapPin className="size-3" /> {session.region}
              </Badge>
            )}
            <Badge variant="ghost">
              <CalendarDays className="size-3" />
              {new Date(session.updatedAt).toLocaleDateString("ru-RU", {
                day: "numeric",
                month: "short",
              })}
            </Badge>
            {session.urgency && <Badge variant="ghost">{urgencyLabels[session.urgency]}</Badge>}
          </div>
          <p className="line-clamp-2 text-sm font-semibold leading-snug">{focus.headline}</p>
          {focus.nextAction && (
            <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
              Следующий ход: {focus.nextAction}
            </p>
          )}
        </div>

        <div className="flex gap-1.5 overflow-x-auto lg:max-w-md lg:justify-end">
          {sections.map((section) => (
            <a
              key={section.href}
              href={section.href}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl border bg-card px-2.5 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground",
                section.primary && "border-primary/30 text-foreground",
              )}
            >
              <section.icon className="size-3.5" />
              {section.label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

function getFocus(output: TypedOutput) {
  if (output.kind === "meeting") {
    const data = output.data as MeetingOutput;
    const next = data.ifYes?.[0] ?? data.ifPause?.[0] ?? data.ifNo?.[0];
    return {
      headline: data.meetingGoal || data.mainThesis,
      nextAction: next?.action,
    };
  }

  if (output.kind === "brief") {
    const data = output.data as BriefOutput;
    return {
      headline: data.decision,
      nextAction: data.nextStep?.action,
    };
  }

  if (output.kind === "region") {
    const data = output.data as RegionAnalysisOutput;
    return {
      headline: data.regionSummary?.oneLiner || data.regionSummary?.name || "Региональный анализ",
      nextAction: data.nextSteps?.[0]?.action,
    };
  }

  const data = output.data as StructuredOutput;
  return {
    headline: data.decision,
    nextAction: data.nextSteps?.[0]?.action,
  };
}

function getSections(output: TypedOutput) {
  if (output.kind === "meeting") {
    return [
      { href: "#decision", label: "Цель", icon: Target, primary: true },
      { href: "#sber-actions", label: "Роль Сбера", icon: BadgeCheck },
      { href: "#agenda", label: "Сценарий", icon: ClipboardList, primary: true },
      { href: "#objections", label: "Возражения", icon: MessageSquare },
      { href: "#follow-up", label: "После встречи", icon: ArrowRight, primary: true },
      { href: "#sources", label: "Проверки", icon: ShieldCheck },
    ];
  }

  if (output.kind === "brief") {
    return [
      { href: "#decision", label: "Решение", icon: FileText, primary: true },
      { href: "#evidence", label: "Факты", icon: CheckCircle2 },
      { href: "#economics", label: "Экономика", icon: BarChart3, primary: true },
      { href: "#risks", label: "Риски", icon: ShieldCheck },
      { href: "#sources", label: "Источники", icon: Flag },
    ];
  }

  if (output.kind === "region") {
    return [
      { href: "#industries", label: "Отрасли", icon: Compass, primary: true },
      { href: "#budget", label: "Бюджет", icon: BarChart3, primary: true },
      { href: "#priorities", label: "Приоритеты", icon: Target, primary: true },
      { href: "#scenarios", label: "Сценарии", icon: Route, primary: true },
      { href: "#competition", label: "Альтернативы", icon: Building2, primary: true },
      { href: "#sources", label: "Источники", icon: Flag },
    ];
  }

  return [
    { href: "#decision", label: "Вердикт", icon: Target, primary: true },
    { href: "#economics", label: "Экономика", icon: BarChart3, primary: true },
    { href: "#bets", label: "Ставки", icon: BadgeCheck },
    { href: "#plan", label: "План", icon: ClipboardList },
    { href: "#risks", label: "Риски", icon: ShieldCheck },

    { href: "#sources", label: "Источники", icon: Flag },
  ];
}
