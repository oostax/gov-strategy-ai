import { NextResponse } from "next/server";
import { updatePlaybookSchema } from "@/lib/schemas/playbook";
import { getStorage } from "@/lib/storage/local-json-storage";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const playbook = await getStorage().getPlaybook(id);
    if (!playbook) return NextResponse.json({ error: "Playbook not found" }, { status: 404 });
    return NextResponse.json({ playbook });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const input = updatePlaybookSchema.parse(await request.json());
    const playbook = await getStorage().updatePlaybook(id, input, "Manual playbook edit");
    return NextResponse.json({ playbook });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Update failed" }, { status: 400 });
  }
}
