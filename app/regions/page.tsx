import Link from "next/link";
import { ArrowLeft, Building2, ChevronRight, Globe, MapPin, Plus, Users } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getStorage } from "@/lib/storage/local-json-storage";

export default async function RegionsPage() {
  const regions = await getStorage().listRegions();
  return (
    <AppShell>
      <div className="mb-4 space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Регионы</h1>
          <Link href="/" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            <ArrowLeft className="size-3.5" /> Главная
          </Link>
        </div>
        <Link
          href="/regions/new"
          className={buttonVariants({ variant: "default", size: "sm" }) + " w-full justify-center"}
        >
          <Plus className="size-4" /> Добавить регион
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {regions.map((region) => (
          <Link key={region.id} href={`/regions/${region.id}`}>
            <Card className="h-full rounded-2xl transition hover:-translate-y-0.5 hover:shadow-md">
              <CardContent className="p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                      <MapPin className="size-4" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold leading-tight">{region.name}</p>
                      {region.federalDistrict && (
                        <p className="text-xs text-muted-foreground">
                          {region.federalDistrict}
                        </p>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Mini
                    icon={Users}
                    label="ЛПР"
                    value={`${region.stakeholders.length}`}
                  />
                  <Mini
                    icon={Building2}
                    label="Проекты"
                    value={`${region.activeProjects.length}`}
                  />
                  <Mini
                    icon={Globe}
                    label="Зрелость"
                    value={region.digitalMaturity ? `${region.digitalMaturity}/5` : "—"}
                  />
                </div>
                {region.sberNote && (
                  <p className="mt-3 line-clamp-2 text-xs italic text-muted-foreground">
                    {region.sberNote}
                  </p>
                )}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}

function Mini({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 p-2">
      <div className="mb-0.5 flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3" /> {label}
      </div>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  );
}
