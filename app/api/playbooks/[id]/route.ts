import { NextResponse } from "next/server";
import { updatePlaybookSchema } from "@/lib/schemas/playbook";
import { getStorage } from "@/lib/storage/local-json-storage";

export const runtime = "nodejs";

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

function validateId(id: string): boolean {
  return SAFE_ID.test(id) && id.length <= 64;
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!validateId(id)) {
      return NextResponse.json({ error: "Invalid playbook ID" }, { status: 400 });
    }
    const playbook = await getStorage().getPlaybook(id);
    if (!playbook) return NextResponse.json({ error: "Playbook not found" }, { status: 404 });
    return NextResponse.json({ playbook });
  } catch {
    return NextResponse.json({ error: "Failed to load playbook" }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!validateId(id)) {
      return NextResponse.json({ error: "Invalid playbook ID" }, { status: 400 });
    }
    const input = updatePlaybookSchema.parse(await request.json());
    const playbook = await getStorage().updatePlaybook(id, input, "Manual playbook edit");
    return NextResponse.json({ playbook });
  } catch (error) {
    console.error("[playbooks] update failed:", error);
    return NextResponse.json({ error: "Failed to update playbook" }, { status: 500 });
  }
}
