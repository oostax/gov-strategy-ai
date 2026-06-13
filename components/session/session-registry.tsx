"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  CalendarDays,
  Clock,
  MapPin,
  Search,
  SlidersHorizontal,
  Star,
  Target,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getSessionTitle,
  taskLabels,
  urgencyLabels,
  type SessionProfile,
  type TaskType,
} from "@/lib/schemas/session";
import { cn } from "@/lib/utils";

const taskOrder: Array<TaskType | "all"> = [
  "all",
  "meeting_preparation",
  "meeting_followup",
  "executive_brief",
  "sber_region_strategy",
  "region_strategy",
  "strategic_bets",
  "scenario_analysis",
];

type RecencyFilter = "all" | "week" | "month";

export function SessionRegistry({ sessions }: { sessions: SessionProfile[] }) {
  const [query, setQuery] = useState("");
  const [task, setTask] = useState<TaskType | "all">("all");
  const [region, setRegion] = useState("all");
  const [recency, setRecency] = useState<RecencyFilter>("all");

  const regions = useMemo(() => {
    const names = new Set(
      sessions
        .map((session) => session.region?.trim())
        .filter((name): name is string => Boolean(name)),
    );
    return Array.from(names).sort((a, b) => a.localeCompare(b, "ru"));
  }, [sessions]);

  const stats = useMemo(() => {
    const today = new Date();
    const weekAgo = daysAgo(today, 7);
    return {
      total: sessions.length,
      recent: sessions.filter((session) => new Date(session.updatedAt) >= weekAgo).length,
      meetings: sessions.filter((session) => session.taskType === "meeting_preparation").length,
      regions: regions.length,
    };
  }, [regions.length, sessions]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const now = new Date();
    const cutoff =
      recency === "week" ? daysAgo(now, 7) : recency === "month" ? daysAgo(now, 30) : null;

    return sessions.filter((session) => {
      if (task !== "all" && session.taskType !== task) return false;
      if (region !== "all" && session.region !== region) return false;
      if (cutoff && new Date(session.updatedAt) < cutoff) return false;
      if (!needle) return true;
      const haystack = [
        getSessionTitle(session),
        session.focusTopic,
        session.region,
        session.meetingWith,
        session.meetingGoal,
        taskLabels[session.taskType],
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [query, recency, region, sessions, task]);

  const hasFilters = query || task !== "all" || region !== "all" || recency !== "all";

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-4">
        <RegistryMetric icon={Target} label="Всего" value={stats.total} />
        <RegistryMetric icon={Clock} label="За 7 дней" value={stats.recent} />
        <RegistryMetric icon={CalendarDays} label="Встреч" value={stats.meetings} />
        <RegistryMetric icon={MapPin} label="Регионов" value={stats.regions} />
      </div>

      <div className="rounded-2xl border bg-card p-3 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Найти по региону, ЛПР, теме или типу материала"
              className="h-10 rounded-xl pl-9"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FilterPill active={recency === "all"} onClick={() => setRecency("all")}>
              Все
            </FilterPill>
            <FilterPill active={recency === "week"} onClick={() => setRecency("week")}>
              7 дней
            </FilterPill>
            <FilterPill active={recency === "month"} onClick={() => setRecency("month")}>
              30 дней
            </FilterPill>
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setQuery("");
                  setTask("all");
                  setRegion("all");
                  setRecency("all");
                }}
              >
                <X className="size-4" /> Сбросить
              </Button>
            )}
          </div>
        </div>

        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {taskOrder.map((value) => (
            <FilterPill
              key={value}
              active={task === value}
              onClick={() => setTask(value)}
              className="shrink-0"
            >
              {value === "all" ? "Все типы" : taskLabels[value]}
            </FilterPill>
          ))}
        </div>

        {regions.length > 0 && (
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            <FilterPill active={region === "all"} onClick={() => setRegion("all")} className="shrink-0">
              Все регионы
            </FilterPill>
            {regions.map((name) => (
              <FilterPill
                key={name}
                active={region === name}
                onClick={() => setRegion(name)}
                className="shrink-0"
              >
                {name}
              </FilterPill>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <SlidersHorizontal className="size-4" />
          <span>
            Показано {filtered.length} из {sessions.length}
          </span>
        </div>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          Сначала самые свежие материалы
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card px-4 py-10 text-center">
          <p className="text-sm font-semibold">Ничего не найдено</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Попробуйте убрать фильтр или изменить запрос.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          {filtered.map((session, index) => (
            <SessionRow
              key={session.id}
              session={session}
              highlighted={index === 0 && !hasFilters}
              separated={index > 0}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SessionRow({
  session,
  highlighted,
  separated,
}: {
  session: SessionProfile;
  highlighted: boolean;
  separated: boolean;
}) {
  const updated = new Date(session.updatedAt);
  const isRecent = updated >= daysAgo(new Date(), 7);

  return (
    <Link
      href={`/sessions/${session.id}`}
      className={cn(
        "group grid gap-3 px-4 py-3 transition hover:bg-muted/50 md:grid-cols-[minmax(0,1fr)_auto]",
        separated && "border-t",
      )}
    >
      <div className="min-w-0">
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          {highlighted && (
            <Badge variant="secondary">
              <Star className="size-3" /> Последняя
            </Badge>
          )}
          <Badge variant={isRecent ? "default" : "outline"}>
            {isRecent ? "Свежая" : "Архив"}
          </Badge>
          <Badge variant="outline">{taskLabels[session.taskType]}</Badge>
          {session.urgency && <Badge variant="ghost">{urgencyLabels[session.urgency]}</Badge>}
        </div>
        <p className="truncate text-sm font-semibold">{getSessionTitle(session)}</p>
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {session.focusTopic || session.meetingGoal || "Тема не указана"}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground md:justify-end">
        {session.region && (
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-3.5" /> {session.region}
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <CalendarDays className="size-3.5" />
          {updated.toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}
        </span>
      </div>
    </Link>
  );
}

function RegistryMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-2xl border bg-card px-3 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function FilterPill({
  active,
  className,
  children,
  onClick,
}: {
  active: boolean;
  className?: string;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center justify-center rounded-xl border px-3 text-xs font-medium transition",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

function daysAgo(base: Date, days: number) {
  const copy = new Date(base);
  copy.setDate(copy.getDate() - days);
  return copy;
}
