import Link from "next/link";
import { Briefcase, ArrowRight } from "lucide-react";
import type { RegionProfile } from "@/lib/schemas/region";
import { pickStrictRelevantSberProjects } from "@/lib/storage/sber-projects";
import { SberProjectCard } from "./sber-project-card";

/**
 * Read-only панель: какие реальные проекты Сбера релевантны этому региону.
 * Каталог — единый глобальный источник (не часть данных региона), здесь только
 * подбор по темам/болям региона. Так данные региона и каталог не смешиваются.
 */
export function RelevantSberProjects({ region }: { region: RegionProfile }) {
  const text = [
    region.name,
    ...(region.topPriorities ?? []).map((p) => p.title),
    ...(region.painPoints ?? []),
    ...(region.federalProjects ?? []),
  ].join(" ");

  const projects = pickStrictRelevantSberProjects(text, region.name, 4);
  if (!projects.length) return null;

  return (
    <section className="space-y-3 rounded-2xl border bg-muted/10 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Briefcase className="size-4 text-primary" /> Проекты Сбера под этот регион
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Подобраны из общего каталога по приоритетам региона — справочно, для опоры в стратегии.
          </p>
        </div>
        <Link
          href="/sber-projects"
          className="inline-flex shrink-0 items-center gap-1 text-xs text-primary hover:underline"
        >
          Весь каталог <ArrowRight className="size-3" />
        </Link>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {projects.map((p) => (
          <SberProjectCard key={p.id} project={p} />
        ))}
      </div>
    </section>
  );
}
