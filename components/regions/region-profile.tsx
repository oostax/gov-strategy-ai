import Link from "next/link";
import type React from "react";
import {
  ArrowLeft,
  BriefcaseBusiness,
  CalendarDays,
  Edit3,
  ExternalLink,
  Landmark,
  Newspaper,
  ShieldAlert,
  Sparkles,
  Target,
  UserRound,
  Users,
} from "lucide-react";
import { RegionCacheStatus } from "@/components/regions/region-cache-status";
import { buttonVariants } from "@/components/ui/button";
import type { RegionProfile, SberProject, Stakeholder, StrategicPriority } from "@/lib/schemas/region";
import { stageLabels } from "@/lib/schemas/region";

export function RegionProfileView({ region }: { region: RegionProfile }) {
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/regions" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          <ArrowLeft className="size-3.5" /> Регионы
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <RegionCacheStatus regionId={region.id} />
          <Link href={`/regions/${region.id}?edit=1`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            <Edit3 className="size-3.5" /> Изменить
          </Link>
        </div>
      </div>

      <section className="rounded-lg border bg-background p-5">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{region.federalDistrict || "Федеральный округ не указан"}</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal">{region.name}</h1>
            {region.population && <p className="mt-2 text-sm text-muted-foreground">Население: {region.population}</p>}
          </div>
          <div className="grid min-w-[280px] gap-2 sm:grid-cols-2">
            <Fact icon={Landmark} label="Бюджет" value={region.budgetProfile} />
            <Fact icon={CalendarDays} label="Цикл" value={region.budgetCycle} />
            <Fact icon={Target} label="Приоритеты" value={`${region.topPriorities.length}`} />
            <Fact icon={Users} label="Ответственные" value={`${region.stakeholders.length}`} />
          </div>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-5">
          {region.budgetProfile && (
            <Section icon={Landmark} title="Бюджетная рамка">
              <p className="text-sm leading-6 text-foreground">{region.budgetProfile}</p>
              {region.budgetCycle && <p className="mt-2 text-sm text-muted-foreground">{region.budgetCycle}</p>}
            </Section>
          )}

          {region.topPriorities.length > 0 && (
            <Section icon={Target} title="Приоритеты региона">
              <div className="space-y-3">
                {region.topPriorities.map((priority) => (
                  <PriorityItem key={priority.id} priority={priority} />
                ))}
              </div>
            </Section>
          )}

          {region.federalProjects.length > 0 && (
            <Section icon={BriefcaseBusiness} title="Государственные программы и проекты">
              <ul className="space-y-2">
                {region.federalProjects.map((project) => (
                  <li key={project} className="rounded-lg border bg-muted/20 px-3 py-2 text-sm leading-5">
                    {project}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {region.painPoints.length > 0 && (
            <Section icon={ShieldAlert} title="Ограничения анализа">
              <ul className="space-y-2">
                {region.painPoints.map((item) => (
                  <li key={item} className="rounded-lg border bg-muted/20 px-3 py-2 text-sm leading-5">
                    {item}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>

        <div className="space-y-5">
          {region.stakeholders.length > 0 && (
            <Section icon={UserRound} title="Руководители и ведомства">
              <div className="space-y-3">
                {region.stakeholders.map((person) => (
                  <StakeholderCard key={person.id} person={person} />
                ))}
              </div>
            </Section>
          )}

          {region.news.length > 0 && (
            <Section icon={Newspaper} title="События и источники">
              <div className="space-y-3">
                {region.news.map((item) => (
                  <div key={item.id} className="rounded-lg border bg-muted/20 p-3">
                    <p className="text-sm font-medium leading-5">{item.title}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {item.date && <span>{item.date}</span>}
                      {item.source && <span>{item.source}</span>}
                      {item.url && (
                        <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary">
                          источник <ExternalLink className="size-3" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {region.activeProjects.length > 0 && (
            <Section icon={Sparkles} title="Портфель Сбера">
              <div className="space-y-3">
                {region.activeProjects.map((project) => (
                  <ActiveProject key={project.id} project={project} />
                ))}
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-background p-4">
      <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
        <Icon className="size-4 text-muted-foreground" /> {title}
      </h2>
      {children}
    </section>
  );
}

function Fact({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value?: string;
}) {
  if (!value) return null;
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" /> {label}
      </div>
      <p className="line-clamp-3 text-sm font-medium leading-5">{value}</p>
    </div>
  );
}

function PriorityItem({ priority }: { priority: StrategicPriority }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <p className="text-sm font-medium leading-5">{priority.title}</p>
      {priority.source && <p className="mt-1 text-xs text-muted-foreground">Источник: {priority.source}</p>}
    </div>
  );
}

function StakeholderCard({ person }: { person: Stakeholder }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <p className="text-sm font-semibold leading-5">{person.fullName}</p>
      <p className="mt-1 text-sm text-muted-foreground">{[person.role, person.department].filter(Boolean).join(" · ")}</p>
      {person.motivation && <p className="mt-2 text-sm leading-5">{person.motivation}</p>}
      {person.notes && <p className="mt-2 text-xs leading-5 text-muted-foreground">{person.notes}</p>}
    </div>
  );
}

function ActiveProject({ project }: { project: SberProject }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <p className="text-sm font-semibold leading-5">{project.title}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {project.product} · {stageLabels[project.stage]}
      </p>
      {project.amount && <p className="mt-2 text-sm">Объем: {project.amount}</p>}
      {project.notes && <p className="mt-2 text-sm leading-5 text-muted-foreground">{project.notes}</p>}
    </div>
  );
}
