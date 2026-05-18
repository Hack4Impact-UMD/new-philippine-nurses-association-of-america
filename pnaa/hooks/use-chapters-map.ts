"use client";

import { useCallback, useEffect, useReducer, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { hydrateTimestamps } from "@/lib/supabase/timestamp";
import type { Chapter } from "@/types/chapter";

export interface ChapterRow extends Chapter {
  id: string;
}

interface ChaptersCache {
  byId: Map<string, ChapterRow>;
  byName: Map<string, ChapterRow>;
  all: ChapterRow[];
}

const EMPTY_CACHE: ChaptersCache = {
  byId: new Map(),
  byName: new Map(),
  all: [],
};

// ---------- Process-wide singleton ----------
// Chapters change rarely (sync runs nightly, admins rarely edit). Fetching the
// table once per page mount — N times when N cards render — is wasteful. We
// hold a module-level cache and a subscriber set; the FIRST consumer triggers
// the fetch, every other consumer reuses the in-flight promise or the result.

let cache: ChaptersCache | null = null;
let inFlight: Promise<void> | null = null;
let lastError: Error | null = null;
const subscribers = new Set<() => void>();
let realtimeChannel: RealtimeChannel | null = null;

function buildCache(rows: ChapterRow[]): ChaptersCache {
  const byId = new Map<string, ChapterRow>();
  const byName = new Map<string, ChapterRow>();
  for (const c of rows) {
    byId.set(c.id, c);
    if (c.name) byName.set(c.name.toLowerCase(), c);
  }
  return { byId, byName, all: rows };
}

function notify(): void {
  for (const fn of subscribers) fn();
}

async function loadChaptersOnce(): Promise<void> {
  if (cache || inFlight) return inFlight ?? Promise.resolve();
  inFlight = (async () => {
    try {
      const supabase = getSupabaseBrowser();
      const { data, error } = await supabase.from("chapters").select("*");
      if (error) throw error;
      const rows = (data ?? []).map(
        (row: Record<string, unknown>) =>
          hydrateTimestamps(row) as unknown as ChapterRow
      );
      cache = buildCache(rows);
      lastError = null;
      ensureRealtime();
    } catch (err) {
      lastError = err as Error;
      cache = EMPTY_CACHE;
    } finally {
      inFlight = null;
      notify();
    }
  })();
  return inFlight;
}

// (#12) Keep the cache fresh: subscribe once and refetch whenever the
// chapters table changes. Without this, the singleton cache was stuck on
// the first read for the lifetime of the page.
function ensureRealtime(): void {
  if (realtimeChannel || typeof window === "undefined") return;
  const supabase = getSupabaseBrowser();
  realtimeChannel = supabase
    .channel("use-chapters-map:chapters")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "chapters" },
      () => {
        cache = null;
        void loadChaptersOnce();
      }
    )
    .subscribe();
}

/** Invalidate the cache + refetch. Call after mutations (e.g. creating a chapter). */
export function invalidateChaptersMap(): void {
  cache = null;
  lastError = null;
  void loadChaptersOnce();
}

/**
 * Returns the singleton chapter lookup maps. The first consumer triggers the
 * fetch; subsequent consumers reuse the in-flight promise or the cached result.
 * Components re-render via the subscriber set when the cache populates.
 */
export function useChaptersMap() {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [error, setError] = useState<Error | null>(lastError);

  useEffect(() => {
    subscribers.add(force);
    if (!cache && !inFlight) {
      loadChaptersOnce().catch((err) => setError(err as Error));
    } else if (lastError) {
      setError(lastError);
    }
    return () => {
      subscribers.delete(force);
    };
  }, []);

  const data = cache ?? EMPTY_CACHE;

  // Stable callbacks so consumer useMemo deps actually memoize across renders.
  // The `data` reference is stable once cache populates (it's a module-level
  // singleton), so the deps array doesn't churn.
  const nameFor = useCallback(
    (id: string | null | undefined, fallback = ""): string =>
      id ? (data.byId.get(id)?.name ?? fallback) : fallback,
    [data]
  );
  const regionFor = useCallback(
    (id: string | null | undefined): string =>
      id ? (data.byId.get(id)?.region ?? "") : "",
    [data]
  );

  return {
    byId: data.byId,
    byName: data.byName,
    all: data.all,
    loading: !cache,
    error,
    nameFor,
    regionFor,
  };
}
