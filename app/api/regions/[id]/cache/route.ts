import { NextResponse } from "next/server";
import { getStorage } from "@/lib/storage/local-json-storage";
import {
  readRegionCache,
  refreshRegionCache,
  getCacheStatus,
  getStaleBlocks,
} from "@/lib/agents/region-blocks/region-cache";

export const runtime = "nodejs";
export const maxDuration = 300;

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!SAFE_ID.test(id)) {
    return NextResponse.json({ error: "Invalid region ID" }, { status: 400 });
  }
  const cache = await readRegionCache(id);
  return NextResponse.json({ status: getCacheStatus(cache) });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!SAFE_ID.test(id)) {
    return NextResponse.json({ error: "Invalid region ID" }, { status: 400 });
  }

  const storage = getStorage();
  const region = await storage.getRegion(id);
  if (!region) {
    return NextResponse.json({ error: "Region not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const forceBlocks = Array.isArray(body.blocks) ? body.blocks : undefined;

  const staleBlocks = forceBlocks || getStaleBlocks(await readRegionCache(id));
  if (staleBlocks.length === 0 && !body.force) {
    const cache = await readRegionCache(id);
    return NextResponse.json({ status: getCacheStatus(cache), message: "Cache is fresh" });
  }

  console.log(`[region-cache] POST refresh ${id}: ${staleBlocks.join(", ")}`);
  const cache = await refreshRegionCache(id, region.name, staleBlocks);
  return NextResponse.json({ status: getCacheStatus(cache) });
}
