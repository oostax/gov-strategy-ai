import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { RegionEditor } from "@/components/regions/region-editor";
import { RelevantSberProjects } from "@/components/sber/relevant-sber-projects";
import { getStorage } from "@/lib/storage/local-json-storage";

export default async function RegionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const region = await getStorage().getRegion(id);
  if (!region) return notFound();
  return (
    <AppShell>
      <div className="space-y-6">
        <RegionEditor initial={region} />
        <RelevantSberProjects region={region} />
      </div>
    </AppShell>
  );
}
