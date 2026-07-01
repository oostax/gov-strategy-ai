import { NextResponse } from "next/server";
import { getStorage } from "@/lib/storage/local-json-storage";

export const runtime = "nodejs";

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

function validateId(id: string): boolean {
  return SAFE_ID.test(id) && id.length <= 64;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!validateId(id)) {
      return NextResponse.json({ error: "Invalid session ID" }, { status: 400 });
    }
    const body = await request.json().catch(() => null);
    if (!body || typeof body.enable !== "boolean") {
      return NextResponse.json({ error: "enable field required" }, { status: 400 });
    }
    const session = await getStorage().rotateShareToken(id, body.enable);
    return NextResponse.json({ session });
  } catch {
    return NextResponse.json({ error: "Share toggle failed" }, { status: 500 });
  }
}
