import Link from "next/link";
import { promises as fs } from "fs";
import {
  ArrowRight,
  Building2,
  ChevronRight,
  CircleAlert,
  FileCheck2,
  MapPin,
  Users,
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { NewSessionTrigger } from "@/components/session/new-session-trigger";
import { Card, CardContent } from "@/components/ui/card";
import { getStorage } from "@/lib/storage/local-json-storage";
import { getSessionTitle, taskLabels } from "@/lib/schemas/session";
import { structuredOutputPath } from "@/lib/agents/region-blocks/storage";
import { assessTypedOutput } from "@/lib/quality/meeting-output-quality";

type SessionReadiness = { exists: boolean; ready: boolean; score: number };

export default async function Home() {
  const storage = getStorage();
  const [allSessions, allRegions] = await Promise.all([
    storage.listSessions(),
    storage.listRegions(),
  ]);
  const sessions = allSessions.slice(0, 6);
  const regions = allRegions.slice(0, 5);
  const readinessEntries = await Promise.all(
    allSessions.map(async (session) => {
      try {
        const raw = await fs.readFile(structuredOutputPath(session.id), "utf8");
        const quality = assessTypedOutput(JSON.parse(raw), { taskType: session.taskType });
        return [session.id, { exists: true, ready: quality.ready, score: quality.score }] as [string, SessionReadiness];
      } catch {
        return [session.id, { exists: false, ready: false, score: 0 }] as [string, SessionReadiness];
      }
    }),
  );
  const readinessById = new Map(readinessEntries);
  const readyCount = readinessEntries.filter(([, status]) => status.ready).length;
  const pendingCount = allSessions.length - readyCount;
  const totalRegions = allRegions.length;

  return (
    <AppShell>
      <div className="space-y-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Рабочий контур
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Материалы и решения</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Сначала — материалы, требующие завершения; затем — готовые решения и региональный контекст.
          </p>
        </div>

        <NewSessionTrigger />

        {/* ── Управленческие сигналы вместо служебных счётчиков ── */}
        <div className="grid gap-2 sm:grid-cols-3">
          <Link href="/sessions">
            <StatCard icon={FileCheck2} value={readyCount} label="Материалов готово" tone="good" />
          </Link>
          <Link href="/sessions">
            <StatCard icon={CircleAlert} value={pendingCount} label="Требуют завершения" tone={pendingCount ? "warn" : "neutral"} />
          </Link>
          <Link href="/regions">
            <StatCard icon={MapPin} value={totalRegions} label="Карточек регионов" tone="neutral" />
          </Link>
        </div>

        {/* ── Две колонки: сессии + регионы ── */}
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Последние сессии */}
          <Card className="rounded-2xl">
            <CardContent className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Последние сессии</h2>
                <Link
                  href="/sessions"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  Все <ArrowRight className="size-3" />
                </Link>
              </div>
              {sessions.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Сессий пока нет
                </p>
              ) : (
                <div className="space-y-0.5">
                  {sessions.map((session) => (
                    <Link
                      key={session.id}
                      href={`/sessions/${session.id}`}
                      className="group flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 transition hover:bg-muted/50"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium">
                            {getSessionTitle(session)}
                          </p>
                          <span className={readinessById.get(session.id)?.ready
                            ? "shrink-0 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700"
                            : "shrink-0 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"}>
                            {readinessById.get(session.id)?.ready
                              ? "Готов"
                              : readinessById.get(session.id)?.exists
                                ? "Требует проверки"
                                : "Без результата"}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {taskLabels[session.taskType]}
                          {session.region ? ` · ${session.region}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="hidden text-xs text-muted-foreground sm:block">
                          {new Date(session.updatedAt).toLocaleDateString("ru-RU", {
                            day: "numeric",
                            month: "short",
                          })}
                        </span>
                        <ChevronRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5" />
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Регионы */}
          <Card className="rounded-2xl">
            <CardContent className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Регионы</h2>
                <Link
                  href="/regions"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  Все <ArrowRight className="size-3" />
                </Link>
              </div>
              <div className="space-y-0.5">
                {regions.map((region) => (
                  <Link
                    key={region.id}
                    href={`/regions/${region.id}`}
                    className="group flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 transition hover:bg-muted/50"
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        <MapPin className="size-3.5" />
                      </span>
                      <div>
                        <p className="text-sm font-medium">{region.name}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Users className="size-3" />
                            {region.stakeholders.length} ЛПР
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Building2 className="size-3" />
                            {region.activeProjects.length} проектов
                          </span>
                          {region.budgetProfile && <span className="line-clamp-1">{region.budgetProfile}</span>}
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5" />
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

function StatCard({
  icon: Icon,
  value,
  label,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: number;
  label: string;
  tone: "good" | "warn" | "neutral";
}) {
  const toneClass = tone === "good"
    ? "bg-emerald-500/10 text-emerald-700"
    : tone === "warn"
      ? "bg-amber-500/10 text-amber-700"
      : "bg-muted text-muted-foreground";
  return (
    <Card className="rounded-xl transition hover:border-foreground/20">
      <CardContent className="flex items-center gap-3 p-3.5">
        <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${toneClass}`}>
          <Icon className="size-4" />
        </span>
        <div>
          <p className="text-xl font-bold tabular-nums leading-tight">{value}</p>
          <p className="text-[11px] text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}
