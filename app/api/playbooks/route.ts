import { NextResponse } from "next/server";
import { getStorage } from "@/lib/storage/local-json-storage";

export const runtime = "nodejs";

export async function GET() {
  try {
    const playbooks = await getStorage().listPlaybooks();
    return NextResponse.json({ playbooks });
  } catch {
    return NextResponse.json({ error: "Failed to list playbooks" }, { status: 500 });
  }
}
