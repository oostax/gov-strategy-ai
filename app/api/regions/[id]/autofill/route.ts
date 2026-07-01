import { NextResponse } from "next/server";
import { buildRegionDraft } from "@/lib/agents/region-autofill";
import { getStorage } from "@/lib/storage/local-json-storage";

export const runtime = "nodejs";
export const maxDuration = 120;

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

function validateId(id: string): boolean {
  return SAFE_ID.test(id) && id.length <= 64;
}

export async function POST(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!validateId(id)) {
      return NextResponse.json({ error: "Invalid region ID" }, { status: 400 });
    }
    const storage = getStorage();
    const region = await storage.getRegion(id);
    if (!region) {
      return NextResponse.json({ error: "Region not found" }, { status: 404 });
    }

    const draft = await buildRegionDraft(region.name);
    const updated = await storage.updateRegion(id, { draft });

    return NextResponse.json({ region: updated, draft });
  } catch (error) {
    console.error("[autofill]", error);
    return NextResponse.json({ error: "Autofill failed" }, { status: 500 });
  }
}
