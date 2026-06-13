export interface RuntimeStatus {
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
    desktopEndpoint?: string;
    desktopFallback: boolean;
    evolutionMode: "a2a" | "desktop_observer" | "unavailable";
  };
}

export function getRuntimeStatus(): RuntimeStatus {
  const hasCloudKey = Boolean(process.env.CLOUD_RU_API_KEY);
  const mempalaceUrl = process.env.MEMPALACE_MCP_URL;
  const mempalaceCommand = process.env.MEMPALACE_COMMAND;
  const ouroborosUrl = process.env.OUROBOROS_A2A_URL || "http://127.0.0.1:18800";
  const ouroborosEnabled = process.env.OUROBOROS_A2A_ENABLED === "true";
  const desktopFallback = process.env.OUROBOROS_DESKTOP_FALLBACK === "true";
  return {
    llm: {
      provider: "cloud_ru",
      connected: hasCloudKey,
      model: process.env.CLOUD_RU_MODEL || "ai-sage/GigaChat3-10B-A1.8B",
    },
    mempalace: {
      connected: Boolean(mempalaceUrl || mempalaceCommand),
      mode: mempalaceUrl ? "mcp_http" : mempalaceCommand ? "mcp_stdio" : "not_configured",
      endpoint: mempalaceUrl,
      command: mempalaceCommand,
    },
    ouroboros: {
      connected: ouroborosEnabled || desktopFallback,
      mode: ouroborosEnabled ? "a2a" : desktopFallback ? "desktop_legacy" : "not_configured",
      endpoint: ouroborosEnabled ? ouroborosUrl : undefined,
      desktopEndpoint: process.env.OUROBOROS_DESKTOP_URL || "http://127.0.0.1:8765",
      desktopFallback,
      evolutionMode: ouroborosEnabled ? "a2a" : desktopFallback ? "desktop_observer" : "unavailable",
    },
  };
}
