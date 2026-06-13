import { AppShell } from "@/components/layout/app-shell";
import { PlaybookEditor } from "@/components/playbooks/playbook-editor";

export default async function PlaybookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AppShell>
      <PlaybookEditor id={id} />
    </AppShell>
  );
}
