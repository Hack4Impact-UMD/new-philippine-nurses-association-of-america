"use client";

import { useMemo } from "react";
import { useCollectionOnce } from "@/hooks/use-firestore";
import type { Chapter } from "@/types/chapter";

export interface ChapterRow extends Chapter {
  id: string;
}

/**
 * Single source of truth for chapter id → row lookups across the app.
 * Loads all chapters once (small table) and exposes byId + byName maps.
 */
export function useChaptersMap() {
  const { data, loading, error } = useCollectionOnce<Chapter>("chapters");

  const { byId, byName, all } = useMemo(() => {
    const byId = new Map<string, ChapterRow>();
    const byName = new Map<string, ChapterRow>();
    for (const c of data as ChapterRow[]) {
      byId.set(c.id, c);
      if (c.name) byName.set(c.name.toLowerCase(), c);
    }
    return { byId, byName, all: data as ChapterRow[] };
  }, [data]);

  return {
    byId,
    byName,
    all,
    loading,
    error,
    /** Convenience: chapter id → display name, with a fallback. */
    nameFor(id: string | null | undefined, fallback = ""): string {
      return id ? (byId.get(id)?.name ?? fallback) : fallback;
    },
    /** Convenience: chapter id → region. */
    regionFor(id: string | null | undefined): string {
      return id ? (byId.get(id)?.region ?? "") : "";
    },
  };
}
