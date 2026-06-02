"use client";

// NOTE: file name kept as `use-firestore` for backwards-compat with the dozens
// of `from "@/hooks/use-firestore"` imports across the codebase. The
// implementation is Supabase under the hood.

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import {
  applyConstraints,
  buildRealtimeFilter,
  rowMatches,
  warnIfHitMaxRows,
  type QueryConstraint,
} from "@/lib/supabase/query";
import { hydrateTimestamps } from "@/lib/supabase/timestamp";

const TABLE_BY_COLLECTION: Record<string, string> = {
  members: "members",
  chapters: "chapters",
  events: "events",
  fundraising: "fundraising",
  users: "users",
  subchapters: "subchapters",
  chapter_aliases: "chapter_aliases",
  attendees: "attendees",
  syncLogs: "sync_logs",
};

function tableFor(name: string): string {
  return TABLE_BY_COLLECTION[name] ?? name;
}

function constraintsKey(constraints: QueryConstraint[]): string {
  return JSON.stringify(constraints);
}

export function useDocument<T>(
  collectionName: string,
  docId: string | undefined
) {
  const [data, setData] = useState<(T & { id: string }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!docId) {
      setLoading(false);
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const supabase = getSupabaseBrowser();
    const table = tableFor(collectionName);

    const fetchOnce = async () => {
      const { data: row, error: err } = await supabase
        .from(table)
        .select("*")
        .eq("id", docId)
        .maybeSingle();
      if (cancelled) return;
      if (err) {
        setError(err);
        setLoading(false);
        return;
      }
      if (row) {
        setData(hydrateTimestamps({ ...row, id: (row as { id: string }).id }) as T & { id: string });
      } else {
        setData(null);
      }
      setLoading(false);
      setError(null);
    };

    fetchOnce();

    const channel: RealtimeChannel = supabase
      .channel(`doc:${table}:${docId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `id=eq.${docId}` },
        (payload: {
          eventType: "INSERT" | "UPDATE" | "DELETE";
          new: Record<string, unknown> | null;
          old: Record<string, unknown> | null;
        }) => {
          if (cancelled) return;
          if (payload.eventType === "DELETE") {
            setData(null);
            return;
          }
          const next = payload.new as Record<string, unknown> | null;
          if (next) {
            setData(hydrateTimestamps({ ...next, id: (next as { id: string }).id }) as T & { id: string });
          }
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [collectionName, docId]);

  return { data, loading, error };
}

export function useCollection<T>(
  collectionName: string,
  constraints: QueryConstraint[] = []
) {
  const [data, setData] = useState<(T & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const constraintsRef = useRef(constraints);
  constraintsRef.current = constraints;

  const key = constraintsKey(constraints);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const supabase = getSupabaseBrowser();
    const table = tableFor(collectionName);

    const fetchOnce = async () => {
      const builder = supabase.from(table).select("*");
      const built = applyConstraints(builder, constraintsRef.current);
      const { data: rows, error: err } = await built;
      if (cancelled) return;
      if (err) {
        setError(err);
        setLoading(false);
        return;
      }
      warnIfHitMaxRows(table, rows?.length ?? 0);
      setData(
        (rows ?? []).map(
          (row: Record<string, unknown>) =>
            hydrateTimestamps({ ...row, id: (row as { id: string }).id }) as T & { id: string }
        )
      );
      setLoading(false);
      setError(null);
    };

    fetchOnce();

    // Realtime: only one filter is supported per channel; pick the first
    // exact-match where() and apply the rest client-side.
    const filter = buildRealtimeFilter(constraintsRef.current);
    const channel: RealtimeChannel = supabase
      .channel(`col:${table}:${key}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table, ...(filter ? { filter } : {}) },
        (payload: {
          eventType: "INSERT" | "UPDATE" | "DELETE";
          new: Record<string, unknown> | null;
          old: Record<string, unknown> | null;
        }) => {
          if (cancelled) return;
          // Easiest correct path: refetch. The collections in this app are
          // small (max ~hundreds of rows in a view) and refetch is cheap.
          if (payload.eventType === "DELETE") {
            const id = (payload.old as { id?: string } | null)?.id;
            if (id) setData((cur) => cur.filter((r) => (r as { id: string }).id !== id));
            return;
          }
          const next = payload.new as Record<string, unknown> | null;
          if (!next) return;
          if (!rowMatches(next, constraintsRef.current)) {
            // Row no longer matches filter — drop it.
            const id = (next as { id?: string }).id;
            if (id) setData((cur) => cur.filter((r) => (r as { id: string }).id !== id));
            return;
          }
          const hydrated = hydrateTimestamps({ ...next, id: (next as { id: string }).id }) as T & { id: string };
          setData((cur) => {
            const idx = cur.findIndex((r) => (r as { id: string }).id === hydrated.id);
            if (idx === -1) return [...cur, hydrated];
            const copy = cur.slice();
            copy[idx] = hydrated;
            return copy;
          });
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionName, key]);

  return { data, loading, error };
}

export function useCollectionOnce<T>(
  collectionName: string,
  constraints: QueryConstraint[] = []
) {
  const [data, setData] = useState<(T & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const constraintsRef = useRef(constraints);
  constraintsRef.current = constraints;
  const key = constraintsKey(constraints);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const supabase = getSupabaseBrowser();
    const table = tableFor(collectionName);
    const builder = supabase.from(table).select("*");
    const built = applyConstraints(builder, constraintsRef.current);
    built.then(({ data: rows, error: err }: { data: Record<string, unknown>[] | null; error: Error | null }) => {
      if (cancelled) return;
      if (err) {
        setError(err);
        setLoading(false);
        return;
      }
      warnIfHitMaxRows(table, rows?.length ?? 0);
      setData(
        (rows ?? []).map(
          (row: Record<string, unknown>) =>
            hydrateTimestamps({ ...row, id: (row as { id: string }).id }) as T & { id: string }
        )
      );
      setError(null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionName, key]);

  return { data, loading, error };
}

export function useDocumentOnce<T>(
  collectionName: string,
  docId: string | undefined
) {
  const [data, setData] = useState<(T & { id: string }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!docId) {
      setLoading(false);
      setData(null);
      return;
    }
    setLoading(true);
    const supabase = getSupabaseBrowser();
    supabase
      .from(tableFor(collectionName))
      .select("*")
      .eq("id", docId)
      .maybeSingle()
      .then(({ data: row, error: err }: { data: Record<string, unknown> | null; error: Error | null }) => {
        if (cancelled) return;
        if (err) {
          setError(err);
          setLoading(false);
          return;
        }
        if (row) {
          setData(hydrateTimestamps({ ...row, id: (row as { id: string }).id }) as T & { id: string });
        } else {
          setData(null);
        }
        setError(null);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [collectionName, docId]);

  return { data, loading, error };
}
