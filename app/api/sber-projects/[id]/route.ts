import { NextResponse } from "next/server";
import { updateSberGovProjectSchema } from "@/lib/storage/sber-projects";
import { getStorage } from "@/lib/storage/local-json-storage";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const input = updateSberGovProjectSchema.parse(await request.json());
    const project = await getStorage().updateSberCatalogProject(id, input);
    return NextResponse.json({ project });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Update failed" },
      { status: 400 },
    );
  }
}

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await getStorage().deleteSberCatalogProject(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Delete failed" },
      { status: 400 },
    );
  }
}
