import { NextResponse } from "next/server";
import { updateRegionInputSchema } from "@/lib/schemas/region";
import { getStorage } from "@/lib/storage/local-json-storage";

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

function validateId(id: string): boolean {
  return SAFE_ID.test(id) && id.length <= 64;
}

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!validateId(id)) {
      return NextResponse.json({ error: "Invalid region ID" }, { status: 400 });
    }
    const region = await getStorage().getRegion(id);
    if (!region) {
      return NextResponse.json({ error: "Region not found" }, { status: 404 });
    }
    return NextResponse.json({ region });
  } catch {
    return NextResponse.json({ error: "Failed to load region" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!validateId(id)) {
      return NextResponse.json({ error: "Invalid region ID" }, { status: 400 });
    }
    const body = await request.json();
    const input = updateRegionInputSchema.parse(body);
    const region = await getStorage().updateRegion(id, input);
    return NextResponse.json({ region });
  } catch (error) {
    console.error("[regions] update failed:", error);
    return NextResponse.json({ error: "Failed to update region" }, { status: 500 });
  }
}

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!validateId(id)) {
      return NextResponse.json({ error: "Invalid region ID" }, { status: 400 });
    }
    await getStorage().deleteRegion(id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete region" }, { status: 500 });
  }
}
