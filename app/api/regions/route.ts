import { NextResponse } from "next/server";
import { createRegionInputSchema } from "@/lib/schemas/region";
import { getStorage } from "@/lib/storage/local-json-storage";

export const runtime = "nodejs";

export async function GET() {
  try {
    const regions = await getStorage().listRegions();
    return NextResponse.json({ regions });
  } catch {
    return NextResponse.json({ error: "Failed to list regions" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = createRegionInputSchema.parse(body);
    const region = await getStorage().createRegion(input);
    return NextResponse.json({ region }, { status: 201 });
  } catch (error) {
    console.error("[regions] create failed:", error);
    return NextResponse.json({ error: "Failed to create region" }, { status: 500 });
  }
}
