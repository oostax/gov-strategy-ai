"use client";

import { useEffect, useState } from "react";
import type { RegionProfile } from "@/lib/schemas/region";

/**
 * Загружает справочник регионов один раз, отдаёт массив и готовый резолвер
 * по id/slug/имени.
 */
export function useRegions() {
  const [regions, setRegions] = useState<RegionProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  function load() {
    if (loaded || loading) return;
    setLoading(true);
    fetch("/api/regions")
      .then((response) => response.json())
      .then((data: { regions?: RegionProfile[] }) => {
        setRegions(data.regions ?? []);
        setLoaded(true);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }

  // Auto-load on mount
  useEffect(() => {
    const timer = window.setTimeout(() => load(), 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function find(query: { id?: string; slug?: string; name?: string }) {
    if (query.id) {
      const byId = regions.find((r) => r.id === query.id);
      if (byId) return byId;
    }
    if (query.slug) {
      const bySlug = regions.find((r) => r.slug === query.slug);
      if (bySlug) return bySlug;
    }
    if (query.name) {
      const q = query.name.trim().toLowerCase();
      return (
        regions.find((r) => r.name.toLowerCase() === q) ??
        regions.find((r) => q.includes(r.slug) || r.name.toLowerCase().includes(q)) ??
        null
      );
    }
    return null;
  }

  return { regions, loading, find };
}
