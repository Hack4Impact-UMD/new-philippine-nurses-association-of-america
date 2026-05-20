"use client";

import { useCallback, useEffect, useReducer, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { hydrateTimestamps } from "@/lib/supabase/timestamp";
import type { Subevent } from "@/types/subevent";

// Process-wide singleton cache for the sub-events catalog, mirroring
// use-chapters-map. The catalog is small (dozens of rows at most) and shared
// across every national-conference page, so one fetch + Realtime updates beat
// per-mount queries.

interface Cache {
  byId: Map<string, Subevent>;
  byNameLower: Map<string, Subevent>;
  all: Subevent[];
}

const EMPTY: Cache = { byId: new Map(), byNameLower: new Map(), all: [] };

let cache: Cache | null = null;
let inFlight: Promise<void> | null = null;
let lastError: Error | null = null;
const subscribers = new Set<() => void>();
let realtimeChannel: RealtimeChannel | null = null;

function build(rows: Subevent[]): Cache {
  const byId = new Map<string, Subevent>();
  const byNameLower = new Map<string, Subevent>();
  for (const s of rows) {
    byId.set(s.id, s);
    if (s.name) byNameLower.set(s.name.toLowerCase(), s);
  }
  return { byId, byNameLower, all: rows };
}

function notify(): void {
  for (const fn of subscribers) fn();
}

async function loadOnce(): Promise<void> {
  if (cache || inFlight) return inFlight ?? Promise.resolve();
  inFlight = (async () => {
    try {
      const supabase = getSupabaseBrowser();
      const { data, error } = await supabase
        .from("subevents")
        .select("*")
        .order("name");
      if (error) throw error;
      const rows = (data ?? []).map(
        (row: Record<string, unknown>) => hydrateTimestamps(row) as unknown as Subevent
      );
      cache = build(rows);
      lastError = null;
      ensureRealtime();
    } catch (err) {
      lastError = err as Error;
      cache = EMPTY;
    } finally {
      inFlight = null;
      notify();
    }
  })();
  return inFlight;
}

function ensureRealtime(): void {
  if (realtimeChannel || typeof window === "undefined") return;
  const supabase = getSupabaseBrowser();
  realtimeChannel = supabase
    .channel("use-subevents:subevents")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "subevents" },
      () => {
        cache = null;
        void loadOnce();
      }
    )
    .subscribe();
}

export function invalidateSubevents(): void {
  cache = null;
  lastError = null;
  void loadOnce();
}

export function useSubevents() {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [error, setError] = useState<Error | null>(lastError);

  useEffect(() => {
    subscribers.add(force);
    if (!cache && !inFlight) {
      loadOnce().catch((err) => setError(err as Error));
    } else if (lastError) {
      setError(lastError);
    }
    return () => {
      subscribers.delete(force);
    };
  }, []);

  const data = cache ?? EMPTY;

  const nameFor = useCallback(
    (id: string | null | undefined, fallback = ""): string =>
      id ? (data.byId.get(id)?.name ?? fallback) : fallback,
    [data]
  );

  return {
    byId: data.byId,
    byNameLower: data.byNameLower,
    all: data.all,
    loading: !cache,
    error,
    nameFor,
  };
}
