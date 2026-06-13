import { NextResponse } from "next/server";
import { checkOuroborosA2A, getOuroborosDesktopState } from "@/lib/integrations/ouroboros-client";
import { getRuntimeStatus } from "@/lib/integrations/runtime-status";

export const runtime = "nodejs";

export async function GET() {
  const status = getRuntimeStatus();
  const [a2a, desktop] = await Promise.allSettled([
    status.ouroboros.mode === "a2a" ? checkOuroborosA2A() : Promise.resolve(null),
    getOuroborosDesktopState(),
  ]);
  return NextResponse.json({
    ...status,
    ouroboros: {
      ...status.ouroboros,
      reachable: a2a.status === "fulfilled" && Boolean(a2a.value),
      agentName:
        a2a.status === "fulfilled" && a2a.value && typeof a2a.value.name === "string"
          ? a2a.value.name
          : undefined,
      desktopReachable: desktop.status === "fulfilled",
      desktopState: desktop.status === "fulfilled" ? desktop.value : undefined,
    },
  });
}
