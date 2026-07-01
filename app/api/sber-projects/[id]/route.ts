import { NextResponse } from "next/server";
import { updateSberGovProjectSchema } from "@/lib/storage/sber-projects";
import { getStorage } from "@/lib/storage/local-json-storage";

export const runtime = "nodejs";

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

function validateId(id: string): boolean {
  return SAFE_ID.test(id) && id.length <= 64;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!validateId(id)) {
      return NextResponse.json({ error: "Invalid project ID" }, { status: 400 });
    }
    const input = updateSberGovProjectSchema.parse(await request.json());
    const project = await getStorage().updateSberCatalogProject(id, input);
    return NextResponse.json({ project });
  } catch (error) {
    console.error("[sber-projects] update failed:", error);
    return NextResponse.json({ error: "Failed to update project" }, { status: 500 });
  }
}

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!validateId(id)) {
      return NextResponse.json({ error: "Invalid project ID" }, { status: 400 });
    }
    await getStorage().deleteSberCatalogProject(id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete project" }, { status: 500 });
  }
}
