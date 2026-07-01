import Link from "next/link";
import { ArrowLeft, Building2, ChevronRight, Landmark, MapPin, Plus, Users } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { buttonVariants } from "@/components/ui/button";
import type { RegionProfile } from "@/lib/schemas/region";
import { getStorage } from "@/lib/storage/local-json-storage";

export default async function RegionsPage() {
  const regions = await getStorage().listRegions();

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Регионы</h1>
            <p className="text-sm text-muted-foreground">
              Паспорт региона, бюджетная рамка, приоритеты и ответственные лица.
            </p>
          </div>
          <Link href="/" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            <ArrowLeft className="size-3.5" /> Главная
          </Link>
        </div>

        <div className="overflow-hidden rounded-lg border bg-background">
          <div className="grid grid-cols-[1.5fr_0.7fr_1.4fr_0.9fr_0.6fr_32px] gap-3 border-b bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground max-lg:hidden">
            <span>Регион</span>
            <span>Округ</span>
            <span>Бюджетная рамка</span>
            <span>Приоритеты</span>
            <span>ЛПР</span>
            <span />
          </div>
          <div className="divide-y">
            {regions.map((region) => (
              <RegionRow key={region.id} region={region} />
            ))}
          </div>
        </div>

        <div className="flex justify-end">
          <Link href="/regions/new" className={buttonVariants({ variant: "outline", size: "sm" })}>
            <Plus className="size-4" /> Добавить регион
          </Link>
        </div>
      </div>
    </AppShell>
  );
}

function RegionRow({ region }: { region: RegionProfile }) {
  const topPriorities = region.topPriorities.slice(0, 2);

  return (
    <Link
      href={`/regions/${region.id}`}
      className="grid gap-3 px-4 py-3 transition hover:bg-muted/30 lg:grid-cols-[1.5fr_0.7fr_1.4fr_0.9fr_0.6fr_32px] lg:items-center"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <MapPin className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{region.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground lg:hidden">
            {region.federalDistrict || "Округ не указан"}
          </p>
        </div>
      </div>
      <p className="hidden text-sm text-muted-foreground lg:block">{region.federalDistrict || "—"}</p>
      <Metric icon={Landmark} value={region.budgetProfile || "Нет подтвержденных данных"} />
      <Metric
        icon={Building2}
        value={topPriorities.length ? topPriorities.map((p) => p.title).join("; ") : "Не заполнены"}
      />
      <Metric icon={Users} value={region.stakeholders.length ? `${region.stakeholders.length}` : "0"} />
      <ChevronRight className="hidden size-4 text-muted-foreground lg:block" />
    </Link>
  );
}

function Metric({
  icon: Icon,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-start gap-1.5 text-sm">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <span className="line-clamp-2 text-muted-foreground">{value}</span>
    </div>
  );
}
