import { Badge } from "@/components/ui/badge";
import type { PlaybookHistory } from "@/lib/schemas/playbook";

export function PlaybookVersionHistory({ history }: { history: PlaybookHistory[] }) {
  return (
    <div className="space-y-3">
      {history.map((item) => (
        <div key={`${item.version}-${item.createdAt}`} className="rounded-2xl border p-3">
          <Badge variant="secondary">v{item.version}</Badge>
          <p className="mt-2 text-sm">{item.change}</p>
          <p className="mt-1 text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString("ru-RU")}</p>
        </div>
      ))}
    </div>
  );
}
