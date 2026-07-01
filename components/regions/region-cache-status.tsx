"use client";

import { useCallback, useEffect, useState } from "react";
import { Database, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type CacheStatus = {
  exists: boolean;
  fetchedAt: string | null;
  fresh: boolean;
  staleBlocks: string[];
  blockCount: number;
};

export function RegionCacheStatus({ regionId }: { regionId: string }) {
  const [status, setStatus] = useState<CacheStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/regions/${regionId}/cache`);
      const data = await res.json();
      setStatus(data.status);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [regionId]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  async function refresh() {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/regions/${regionId}/cache`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      const data = await res.json();
      setStatus(data.status);
      toast.success(data.status?.fresh ? "Данные региона обновлены" : "Обновление запущено");
    } catch {
      toast.error("Не удалось обновить кэш региона");
    } finally {
      setRefreshing(false);
    }
  }

  if (loading) return null;

  const fresh = status?.fresh;
  const age = status?.fetchedAt
    ? Math.round((Date.now() - new Date(status.fetchedAt).getTime()) / (24 * 60 * 60 * 1000))
    : null;

  return (
    <div className="flex items-center gap-2">
      <Badge variant={fresh ? "secondary" : "outline"} className="text-[10px]">
        <Database className="mr-1 size-3" />
        {fresh ? `Кэш свежий${age !== null ? ` (${age}д)` : ""}` : status?.exists ? "Кэш устарел" : "Нет кэша"}
      </Badge>
      {status && !fresh && status.staleBlocks.length > 0 && (
        <span className="text-[10px] text-muted-foreground">
          устарели: {status.staleBlocks.join(", ")}
        </span>
      )}
      <Button variant="ghost" size="sm" onClick={refresh} disabled={refreshing}>
        {refreshing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
      </Button>
    </div>
  );
}
