import Link from "next/link";
import {
  ArrowRight,
  Building2,
  ChevronRight,
  MapPin,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { NewSessionTrigger } from "@/components/session/new-session-trigger";
import { Card, CardContent } from "@/components/ui/card";
import { getStorage } from "@/lib/storage/local-json-storage";
import { getSessionTitle, taskLabels } from "@/lib/schemas/session";

export default async function Home() {
  const sessions = (await getStorage().listSessions()).slice(0, 6);
  const regions = (await getStorage().listRegions()).slice(0, 5);
  const playbooks = await getStorage().listPlaybooks();

  // Stats
  const totalSessions = (await getStorage().listSessions()).length;
  const totalRegions = regions.length;
  const totalRules = playbooks.reduce((sum, p) => sum + p.rules.length, 0);

  return (
    <AppShell>
      <div className="space-y-6">
        {/* ── Hero: одна большая кнопка ── */}
        <div>
          <NewSessionTrigger />
        </div>

        {/* ── Статистика ── */}
        <div className="grid grid-cols-3 gap-2">
          <Link href="/sessions">
            <StatCard icon={Zap} value={totalSessions} label="Сессий" />
          </Link>
          <Link href="/regions">
            <StatCard icon={MapPin} value={totalRegions} label="Регионов" />
          </Link>
          <Link href="/playbooks">
            <StatCard icon={TrendingUp} value={totalRules} label="Правил" />
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
                        <p className="truncate text-sm font-medium">
                          {getSessionTitle(session)}
                        </p>
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
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-0.5">
                            <Users className="size-3" />
                            {region.stakeholders.length}
                          </span>
                          <span className="inline-flex items-center gap-0.5">
                            <Building2 className="size-3" />
                            {region.activeProjects.length}
                          </span>
                          {region.budgetProfile && <span>{region.budgetProfile}</span>}
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
  value,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: number;
  label: string;
}) {
  return (
    <Card className="rounded-xl">
      <CardContent className="p-3 text-center">
        <p className="text-xl font-bold tabular-nums leading-tight">{value}</p>
        <p className="text-[10px] text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}
