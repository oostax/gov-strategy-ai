import { AlertCircle, Building2, CheckCircle2, Database } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { AgentOutput } from "@/lib/schemas/output";
import type { SessionProfile } from "@/lib/schemas/session";

export function TrustPanel({ output, session }: { output: AgentOutput | null; session: SessionProfile }) {
  const hasOutput = Boolean(output);
  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle className="text-base">Проверяемость и роль Сбера</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="rounded-2xl border p-3">
          <div className="mb-2 flex items-center gap-2 font-medium">
            <Database className="size-4" />
            Откуда взят контекст
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Вводные сессии</Badge>
            <Badge variant="secondary">Активные правила</Badge>
            <Badge variant="outline">{session.region || "регион не указан"}</Badge>
          </div>
          <p className="mt-2 text-muted-foreground">
            Система использует открытые источники и указывает их в карточке результата. При недостатке источников факты остаются гипотезами до проверки.
          </p>
        </div>
        <div className="rounded-2xl border p-3">
          <div className="mb-2 flex items-center gap-2 font-medium">
            {hasOutput ? <CheckCircle2 className="size-4" /> : <AlertCircle className="size-4" />}
            Статус ответа
          </div>
          <p className="text-muted-foreground">
            {hasOutput
              ? "Материал сформирован. Числа, внешние факты и актуальные региональные данные нужно подтверждать источниками перед встречей."
              : "После генерации здесь будет видно, какие части ответа основаны на вводных, а какие требуют проверки."}
          </p>
        </div>
        <div className="rounded-2xl border p-3">
          <div className="mb-2 flex items-center gap-2 font-medium">
            <Building2 className="size-4" />
            Как Сбер может помочь
          </div>
          <p className="text-muted-foreground">
            Снять базовую линию процесса, собрать финансовую модель эффекта, определить данные и интеграции, подготовить демонстрационный контур и вынести решение на управляющий комитет.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
