import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { RegionEditor } from "@/components/regions/region-editor";
import { RegionProfileView } from "@/components/regions/region-profile";
import { getStorage } from "@/lib/storage/local-json-storage";

export default async function RegionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const { id } = await params;
  const { edit } = await searchParams;
  const region = await getStorage().getRegion(id);
  if (!region) return notFound();

  if (edit === "1") {
    return (
      <AppShell>
        <RegionEditor initial={region} />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <RegionProfileView region={region} />
    </AppShell>
  );
}
