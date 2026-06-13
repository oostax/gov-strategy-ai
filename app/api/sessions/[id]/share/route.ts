import { NextResponse } from "next/server";
import { getStorage } from "@/lib/storage/local-json-storage";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { enable } = (await request.json().catch(() => ({ enable: true }))) as {
      enable?: boolean;
    };
    const session = await getStorage().rotateShareToken(id, enable ?? true);
    return NextResponse.json({ session });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Share toggle failed" },
      { status: 400 },
    );
  }
}
