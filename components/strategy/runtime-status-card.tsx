"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, BrainCircuit, CheckCircle2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface RuntimeStatusResponse {
  llm: {
    provider: "cloud_ru";
    connected: boolean;
    model: string;
  };
  mempalace: {
    connected: boolean;
    mode: "mcp_http" | "mcp_stdio" | "not_configured";
    endpoint?: string;
    command?: string;
  };
  ouroboros: {
    connected: boolean;
    mode: "a2a" | "desktop_legacy" | "not_configured";
    endpoint?: string;
    reachable?: boolean;
    desktopReachable?: boolean;
    agentName?: string;
    desktopFallback?: boolean;
    evolutionMode?: "a2a" | "desktop_observer" | "unavailable";
  };
}

function StatusLine({
  ok,
  title,
  description,
}: {
  ok: boolean;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-3 rounded-2xl border p-3">
      {ok ? <CheckCircle2 className="mt-0.5 size-4 text-emerald-600" /> : <AlertTriangle className="mt-0.5 size-4 text-amber-600" />}
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        <p className="break-words text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

export function RuntimeStatusCard() {
  const [status, setStatus] = useState<RuntimeStatusResponse | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/runtime/status")
      .then((response) => response.json())
      .then((data: RuntimeStatusResponse) => {
        if (alive) setStatus(data);
      })
      .catch(() => {
        if (alive) setStatus(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BrainCircuit className="size-4" />
          Реальный контур ИИ
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!status ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <RefreshCw className="size-4 animate-spin" />
            Проверяю runtime
          </div>
        ) : (
          <>
            <StatusLine
              ok={status.llm.connected}
              title="Cloud.ru Foundation Models"
              description={status.llm.connected ? `Подключена модель ${status.llm.model}` : "API key не задан. Mock mode отключен."}
            />
            <StatusLine
              ok={Boolean(status.ouroboros.connected && (status.ouroboros.reachable || status.ouroboros.desktopReachable))}
              title="Ouroboros Desktop"
              description={
                status.ouroboros.reachable
                  ? `Прямой runtime endpoint доступен: ${status.ouroboros.agentName || status.ouroboros.endpoint}`
                  : status.ouroboros.desktopReachable && status.ouroboros.desktopFallback
                    ? "Ouroboros Desktop доступен через локальный API. Фидбек не блокирует чат Desktop: улучшение выполняется Cloud.ru и сохраняется в MemPalace"
                    : status.ouroboros.connected
                      ? `Настроен, но endpoint не отвечает: ${status.ouroboros.endpoint || "Desktop API"}`
                      : "Не включен. Feedback evolution будет заблокирован."
              }
            />
            <StatusLine
              ok={status.mempalace.connected}
              title="MemPalace"
              description={status.mempalace.connected ? `Память подключена через ${status.mempalace.mode}` : "MEMPALACE_MCP_URL или MEMPALACE_COMMAND не заданы. Сессии и генерация будут заблокированы, чтобы не имитировать память."}
            />
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">ответы: Cloud.ru</Badge>
              <Badge variant="secondary">
                эволюция: {status.ouroboros.reachable ? "прямой runtime" : "Cloud.ru + MemPalace"}
              </Badge>
              <Badge variant="outline">память: MemPalace</Badge>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
