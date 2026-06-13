import { Building2, Ban, Info } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { SberCatalogManager } from "@/components/sber/sber-catalog-manager";
import { notSberProducts, drgsNote } from "@/lib/storage/sber-projects";

export const metadata = {
  title: "Проекты Сбера в госсекторе",
};

export default function SberProjectsPage() {
  return (
    <AppShell>
      <div className="space-y-5">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Building2 className="size-5 text-primary" /> Проекты Сбера в госсекторе (РГС)
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Редактируемый каталог реальных продуктов и кейсов Сбера для регионального госсектора.
            Это глобальная опора для стратегий — данные конкретного региона редактируются отдельно,
            на странице региона.
          </p>
        </div>

        <div className="flex items-start gap-2 rounded-2xl border bg-muted/20 p-3 text-xs leading-snug text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0 text-primary" />
          <span>{drgsNote}</span>
        </div>

        <SberCatalogManager />

        <div className="rounded-2xl border border-destructive/20 bg-destructive/[0.03] p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-destructive">
            <Ban className="size-4" /> Не приписывать Сберу
          </h2>
          <ul className="mt-2 space-y-1">
            {notSberProducts.map((item, idx) => (
              <li key={idx} className="text-xs leading-snug text-muted-foreground">
                — {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </AppShell>
  );
}
