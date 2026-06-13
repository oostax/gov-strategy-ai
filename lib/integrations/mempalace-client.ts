import { spawn } from "node:child_process";
import type { Feedback } from "@/lib/schemas/feedback";
import type { AgentOutput } from "@/lib/schemas/output";
import type { EvolutionResult } from "@/lib/schemas/playbook";
import type { SessionProfile } from "@/lib/schemas/session";
import { getRuntimeStatus } from "./runtime-status";

export interface MemoryHit {
  id: string;
  title: string;
  excerpt: string;
  source: "mempalace";
  score?: number;
}

export interface MemoryClient {
  search(query: string): Promise<MemoryHit[]>;
  rememberSession(session: SessionProfile): Promise<void>;
  rememberOutput(output: AgentOutput): Promise<void>;
  rememberFeedback(feedback: Feedback): Promise<void>;
  rememberEvolution(result: EvolutionResult): Promise<void>;
}

interface McpTextResponse {
  result?: {
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  };
  error?: {
    message?: string;
  };
}

async function callMcpTool<T>(toolName: string, args: Record<string, unknown>): Promise<T | null> {
  const endpoint = process.env.MEMPALACE_MCP_URL;
  if (!endpoint) return callMcpStdioTool<T>(toolName, args);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: "tools/call",
      params: {
        name: toolName,
        arguments: args,
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`MemPalace MCP request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

function parseMcpToolResult<T>(response: McpTextResponse): T {
  if (response.error) {
    throw new Error(`MemPalace MCP error: ${response.error.message || "unknown error"}`);
  }
  const text = response.result?.content?.find((item) => item.type === "text" && item.text)?.text;
  if (!text) {
    throw new Error("MemPalace MCP returned empty tool result.");
  }
  return JSON.parse(text) as T;
}

async function callMcpStdioTool<T>(toolName: string, args: Record<string, unknown>): Promise<T> {
  const command = process.env.MEMPALACE_COMMAND;
  if (!command) throw new Error("MemPalace MCP command is not configured.");

  return new Promise<T>((resolve, reject) => {
    const child = spawn(command, { shell: true, stdio: ["pipe", "pipe", "pipe"] });
    const requestId = crypto.randomUUID();
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("MemPalace MCP stdio request timed out."));
    }, 30000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      for (const line of stdout.split("\n")) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as McpTextResponse & { id?: string };
          if (parsed.id === requestId) {
            clearTimeout(timeout);
            child.kill();
            resolve(parseMcpToolResult<T>(parsed));
          }
        } catch {
          continue;
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", () => {
      clearTimeout(timeout);
      if (!stdout.includes(requestId)) {
        reject(new Error(`MemPalace MCP stdio closed without response. ${stderr}`.trim()));
      }
    });

    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method: "initialize", params: {} }) + "\n");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");
    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: requestId,
        method: "tools/call",
        params: {
          name: toolName,
          arguments: args,
        },
      }) + "\n",
    );
  });
}

function assertMemPalaceConnected() {
  if (!getRuntimeStatus().mempalace.connected) {
    throw new Error("MemPalace is required but not configured. Set MEMPALACE_MCP_URL or MEMPALACE_COMMAND.");
  }
}

export function getMemoryClient(): MemoryClient {
  return {
    async search(query) {
      assertMemPalaceConnected();
      const result = await callMcpTool<{
        results?: Array<{
          id?: string;
          content?: string;
          document?: string;
          text?: string;
          wing?: string;
          room?: string;
          source_file?: string;
          similarity?: number;
          metadata?: { wing?: string; room?: string };
          distance?: number;
          score?: number;
        }>;
        error?: string;
      }>("mempalace_search", { query, limit: 5, wing: "gov_strategy_ai" });
      if (result?.error) {
        console.warn(`[mempalace] search degraded: ${result.error}`);
        return [];
      }
      return (result?.results ?? []).map((item, index) => ({
        id: item.id || `mempalace_${index}`,
        title: `${item.metadata?.room || item.room || "memory"} · ${item.metadata?.wing || item.wing || "gov_strategy_ai"}`,
        excerpt: item.content || item.document || item.text || "",
        source: "mempalace",
        score: item.score ?? item.similarity ?? (typeof item.distance === "number" ? 1 - item.distance : undefined),
      }));
    },
    async rememberSession(session) {
      assertMemPalaceConnected();
      await callMcpTool("mempalace_add_drawer", {
        wing: "gov_strategy_ai",
        room: session.id,
        content: JSON.stringify(session, null, 2),
        source_file: "gov-strategy-ai/session",
        added_by: "gov-strategy-ai",
      });
    },
    async rememberOutput(output) {
      assertMemPalaceConnected();
      await callMcpTool("mempalace_add_drawer", {
        wing: "gov_strategy_ai",
        room: output.sessionId,
        content: JSON.stringify(output, null, 2),
        source_file: "gov-strategy-ai/agent_output",
        added_by: "gov-strategy-ai",
      });
    },
    async rememberFeedback(feedback) {
      assertMemPalaceConnected();
      await callMcpTool("mempalace_add_drawer", {
        wing: "gov_strategy_ai",
        room: `decision_memory_${feedback.sessionId}`,
        content: JSON.stringify(
          {
            type: "decision_feedback",
            sessionId: feedback.sessionId,
            outputId: feedback.outputId,
            rating: feedback.rating,
            criticized: feedback.tags,
            userComment: feedback.comment,
            memoryRule:
              feedback.rating <= 3
                ? "В следующих похожих ответах избегать раскритикованного паттерна; усиливать предметную роль Сбера, baseline, источники и управленческое решение."
                : "В следующих похожих ответах повторять удачный паттерн и формулировки.",
            createdAt: feedback.createdAt,
          },
          null,
          2,
        ),
        source_file: "gov-strategy-ai/decision_feedback",
        added_by: "gov-strategy-ai",
      });
    },
    async rememberEvolution(result) {
      assertMemPalaceConnected();
      await callMcpTool("mempalace_add_drawer", {
        wing: "gov_strategy_ai",
        room: result.rewrittenAnswer.sessionId,
        content: JSON.stringify(
          {
            type: "decision_evolution",
            problem: result.problem,
            improvement: result.improvement,
            newRule: result.newRule,
            playbookUpdate: result.playbookUpdate,
            goodPattern: result.improvement,
            avoidPattern: result.problem,
          },
          null,
          2,
        ),
        source_file: "gov-strategy-ai/evolution",
        added_by: "gov-strategy-ai",
      });
    },
  };
}
