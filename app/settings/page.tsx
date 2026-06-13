import Link from "next/link";
import {
  ArrowLeft,
  Brain,
  CheckCircle2,
  Cloud,
  Database,
  Server,
  XCircle,
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getRuntimeStatus } from "@/lib/integrations/runtime-status";
import { getStorage } from "@/lib/storage/local-json-storage";

export default async function SettingsPage() {
  const status = getRuntimeStatus();
  const playbooks = await getStorage().listPlaybooks();
  const totalRules = playbooks.reduce((sum, p) => sum + p.rules.length, 0);

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Настройки</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Подключения, модель и состояние системы
            </p>
          </div>
          <Link href="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
            <ArrowLeft className="size-4" /> На главную
          </Link>
        </div>

        {/* Status cards */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <StatusCard
            icon={Cloud}
            title="LLM-модель"
            status={status.llm.connected}
            details={[
              { label: "Провайдер", value: "Cloud.ru Foundation Models" },
              { label: "Модель", value: "GigaChat-3 10B" },
              { label: "API-ключ", value: status.llm.connected ? "подключён" : "не задан" },
            ]}
          />
          <StatusCard
            icon={Database}
            title="Память (MemPalace)"
            status={status.mempalace.connected}
            details={[
              { label: "Режим", value: status.mempalace.mode || "не подключён" },
              { label: "Статус", value: status.mempalace.connected ? "работает" : "недоступен" },
            ]}
          />
          <StatusCard
            icon={Server}
            title="Ouroboros Desktop"
            status={status.ouroboros.connected}
            details={[
              { label: "Режим", value: status.ouroboros.mode || "не настроен" },
              { label: "Статус", value: status.ouroboros.connected ? "подключён" : "недоступен" },
            ]}
          />
        </div>

        {/* System info */}
        <Card className="rounded-2xl">
          <CardContent className="p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Brain className="size-4 text-muted-foreground" /> Агент
            </h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <InfoBlock label="Playbook'ов" value={`${playbooks.length}`} />
              <InfoBlock label="Правил агента" value={`${totalRules}`} />
              <InfoBlock label="Хранилище" value="Локальный JSON" />
            </div>
          </CardContent>
        </Card>

        {/* Env hint */}
        <p className="text-xs text-muted-foreground">
          Настройки подключений задаются через <code className="rounded bg-muted px-1 py-0.5">.env.local</code>.
          API-ключи не хранятся в UI.
        </p>
      </div>
    </AppShell>
  );
}

function StatusCard({
  icon: Icon,
  title,
  status,
  details,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  status: boolean;
  details: Array<{ label: string; value: string }>;
}) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">{title}</h3>
          </div>
          {status ? (
            <CheckCircle2 className="size-4 text-emerald-600" />
          ) : (
            <XCircle className="size-4 text-destructive" />
          )}
        </div>
        <div className="space-y-1.5">
          {details.map((d) => (
            <div key={d.label} className="flex items-baseline justify-between gap-2">
              <span className="text-xs text-muted-foreground">{d.label}</span>
              <span className="text-right text-xs font-medium">{d.value}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-muted/30 p-3">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-lg font-bold">{value}</p>
    </div>
  );
}
