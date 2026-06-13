import { NextResponse } from "next/server";
import { createSberGovProjectSchema } from "@/lib/storage/sber-projects";
import { getStorage } from "@/lib/storage/local-json-storage";

export const runtime = "nodejs";

export async function GET() {
  try {
    const projects = await getStorage().listSberCatalog();
    return NextResponse.json({ projects });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const input = createSberGovProjectSchema.parse(await request.json());
    const project = await getStorage().createSberCatalogProject(input);
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid request" },
      { status: 400 },
    );
  }
}
