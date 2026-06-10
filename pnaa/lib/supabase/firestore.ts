// Drop-in replacement for lib/firebase/firestore.ts using Supabase / Postgres.
// Exposes the same surface: where/orderBy/limit constraints, Timestamp,
// serverTimestamp, addDocument/updateDocument/archiveDocument helpers.

import { getSupabaseBrowser } from "./client";
import {
  applyConstraints,
  buildRealtimeFilter,
  warnIfHitMaxRows,
  type QueryConstraint,
} from "./query";
import {
  hydrateTimestamps,
  serializeTimestamps,
  Timestamp,
  serverTimestamp,
} from "./timestamp";
import type { Member } from "@/types/member";
import type { Chapter } from "@/types/chapter";
import type { AppEvent } from "@/types/event";
import type { FundraisingCampaign } from "@/types/fundraising";
import type { AppUser } from "@/types/user";

// Collection-name → table-name map. Firestore used "fundraising"; Postgres
// table names are lowercase, so most names line up 1:1 already.
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

function tableFor(collection: string): string {
  return TABLE_BY_COLLECTION[collection] ?? collection;
}

// Pseudo-references for parity with the old Firestore code that did
// `import { membersRef } from "@/lib/firebase/firestore"`. These are just
// table-name strings tagged so callers can pass them around.
export const membersRef = "members" as const;
export const chaptersRef = "chapters" as const;
export const eventsRef = "events" as const;
export const fundraisingRef = "fundraising" as const;
export const usersRef = "users" as const;

// ---------- read helpers ----------

export async function getDocument<T>(
  collectionName: string,
  docId: string
): Promise<T | null> {
  const supabase = getSupabaseBrowser();
  const { data, error } = await supabase
    .from(tableFor(collectionName))
    .select("*")
    .eq("id", docId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return hydrateTimestamps(data) as T;
}

export async function queryCollection<T>(
  collectionName: string,
  ...constraints: QueryConstraint[]
): Promise<T[]> {
  const supabase = getSupabaseBrowser();
  const builder = supabase.from(tableFor(collectionName)).select("*");
  const q = applyConstraints(builder, constraints);
  const { data, error } = await q;
  if (error) throw error;
  warnIfHitMaxRows(tableFor(collectionName), data?.length ?? 0);
  return (data ?? []).map((row: Record<string, unknown>) => hydrateTimestamps(row)) as T[];
}

// ---------- write helpers ----------

function prepareForWrite<T extends Record<string, unknown>>(data: T): Record<string, unknown> {
  return serializeTimestamps(data) as unknown as Record<string, unknown>;
}

export async function addDocument<T extends Record<string, unknown>>(
  collectionName: string,
  data: T
): Promise<string> {
  const supabase = getSupabaseBrowser();
  // Don't auto-inject creationDate/lastUpdated — each table has different
  // timestamp columns (creationDate, createdAt, lastSynced …) and Postgres
  // DEFAULT now() / the per-table triggers already populate them. If a caller
  // wants to override, they can pass the field explicitly.
  const payload = prepareForWrite({ ...data });
  const { data: inserted, error } = await supabase
    .from(tableFor(collectionName))
    .insert(payload)
    .select("id")
    .single();
  if (error) throw error;
  return (inserted as { id: string }).id;
}

export async function updateDocument(
  collectionName: string,
  docId: string,
  data: Record<string, unknown>
): Promise<void> {
  const supabase = getSupabaseBrowser();
  const payload = prepareForWrite({ ...data });
  // lastUpdated trigger handles this server-side, but set explicitly for
  // tables that don't have the trigger (e.g. attendees uses updatedAt).
  const { error } = await supabase
    .from(tableFor(collectionName))
    .update(payload)
    .eq("id", docId);
  if (error) throw error;
}

export async function archiveDocument(
  collectionName: string,
  docId: string
): Promise<void> {
  await updateDocument(collectionName, docId, { archived: true });
}

// ---------- doc/getDoc/deleteDoc parity (for the few call sites using them) ----------

/** Returns a tagged ref tuple that getDoc/deleteDoc accept. */
export function doc(
  collection: string,
  id: string,
  ...rest: string[]
): { table: string; id: string; parentPath?: string[] } {
  // Subcollection style: doc("events", eventId, "attendees", attendeeId)
  // → table="attendees", id=attendeeId, parentPath=["events", eventId]
  if (rest.length >= 2) {
    return {
      table: tableFor(rest[0]),
      id: rest[1],
      parentPath: [collection, id, ...rest.slice(2)],
    };
  }
  return { table: tableFor(collection), id };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getDoc(ref: { table: string; id: string }): Promise<{
  exists: () => boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: () => any;
  id: string;
}> {
  const supabase = getSupabaseBrowser();
  const { data, error } = await supabase
    .from(ref.table)
    .select("*")
    .eq("id", ref.id)
    .maybeSingle();
  if (error) throw error;
  const hydrated = data ? hydrateTimestamps(data) : undefined;
  return {
    exists: () => !!hydrated,
    data: () => hydrated,
    id: ref.id,
  };
}

export async function deleteDoc(ref: { table: string; id: string }): Promise<void> {
  const supabase = getSupabaseBrowser();
  const { error } = await supabase.from(ref.table).delete().eq("id", ref.id);
  if (error) throw error;
}

// ---------- re-exports ----------
export { where, orderBy, limit } from "./query";
export type { QueryConstraint } from "./query";
export { Timestamp, serverTimestamp };
export type { Member, Chapter, AppEvent, FundraisingCampaign, AppUser };

// query() / collection() shims for call sites doing
// `query(collection("events"), where(...), orderBy(...))`.
// They just collect constraints into a tagged tuple that getDocs can replay.
export function collection(name: string, ...rest: string[]): { table: string; parentPath?: string[] } {
  if (rest.length >= 2) {
    return {
      table: tableFor(rest[1]),
      parentPath: [name, rest[0], ...rest.slice(2)],
    };
  }
  return { table: tableFor(name) };
}

/**
 * collectionGroup shim — with the flat attendees table this is just
 * `from("attendees")`. Other group queries collapse the same way.
 */
export function collectionGroup(name: string): { table: string } {
  return { table: tableFor(name) };
}

/**
 * DocumentSnapshot-compatible type. We only need enough shape for keyset
 * pagination cursors used in member-list / attendee-list (they read the
 * last row's sort-field value) and `d.ref.parent.parent.id` for the
 * collectionGroup("attendees") query in member-detail.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface DocumentSnapshot {
  id: string;
  // Returns the raw row. `any` here matches Firestore's DocumentData and keeps
  // the existing `(d.data() as Attendee)` cast sites unchanged.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: () => any;
  get: (field: string) => unknown;
  exists?: () => boolean;
  ref: {
    parent: { parent: { id: string } | null };
    id?: string;
    table?: string;
  };
}

export function snapshotFromRow(row: Record<string, unknown>): DocumentSnapshot {
  return {
    id: String(row.id ?? ""),
    data: () => row,
    get: (field: string) => row[field],
    ref: { parent: { parent: null } },
  };
}

/** startAfter shim — re-export the canonical type from query.ts. */
export { type StartAfterConstraintCarrier } from "./query";

import type { StartAfterConstraintCarrier } from "./query";

export function startAfter(cursor: DocumentSnapshot | null): StartAfterConstraintCarrier {
  if (!cursor) return { __kind: "startAfter", cursor: null };
  return {
    __kind: "startAfter",
    cursor: {
      data: () => cursor.data() as Record<string, unknown>,
      get: (field: string) => cursor.get(field),
    },
  };
}

/**
 * onSnapshot shim — wraps the Supabase Realtime channel into a Firestore-style
 * callback. Returns an unsubscribe function. Best-effort: applies the first
 * exact-match where() as the postgres_changes filter and refetches on changes
 * to keep ordering / multi-field filters consistent.
 */
export function onSnapshot(
  q: { table: string; constraints?: QueryConstraint[] },
  onNext: (snap: {
    docs: DocumentSnapshot[];
    size: number;
    empty: boolean;
  }) => void,
  onError?: (err: Error) => void
): () => void {
  const supabase = getSupabaseBrowser();
  const constraints = q.constraints ?? [];

  const fetchAndEmit = async () => {
    try {
      const builder = supabase.from(q.table).select("*");
      const built = applyConstraints(builder, constraints);
      const { data, error } = await built;
      if (error) {
        onError?.(error);
        return;
      }
      const rows = (data ?? []).map((row: Record<string, unknown>) =>
        hydrateTimestamps(row)
      ) as Record<string, unknown>[];
      const docs: DocumentSnapshot[] = rows.map((row) => ({
        id: String(row.id ?? ""),
        data: () => row,
        get: (field: string) => row[field],
        exists: () => true,
        // Compatibility shim: `ref.parent.parent.id` for collectionGroup callers
        // wanting the eventId. attendees table carries eventId directly.
        ref: {
          id: String(row.id ?? ""),
          table: q.table,
          parent: { parent: { id: String(row.eventId ?? "") } },
        },
      }));
      onNext({ docs, size: docs.length, empty: docs.length === 0 });
    } catch (err) {
      onError?.(err as Error);
    }
  };

  fetchAndEmit();

  // (#10) Build the Realtime filter through the safe-escape helper so values
  // containing commas / dots / parens don't corrupt the parser.
  const filter = buildRealtimeFilter(constraints);

  const channel = supabase
    .channel(`onSnapshot:${q.table}:${JSON.stringify(constraints)}`)
    .on(
      "postgres_changes" as never,
      { event: "*", schema: "public", table: q.table, ...(filter ? { filter } : {}) } as never,
      () => {
        fetchAndEmit();
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export function query(
  ref: { table: string },
  ...constraints: QueryConstraint[]
): { table: string; constraints: QueryConstraint[] } {
  return { table: ref.table, constraints };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getDocs(q: {
  table: string;
  constraints?: QueryConstraint[];
}): Promise<{
  docs: DocumentSnapshot[];
  size: number;
  empty: boolean;
}> {
  const supabase = getSupabaseBrowser();
  const builder = supabase.from(q.table).select("*");
  const built = applyConstraints(builder, q.constraints ?? []);
  const { data, error } = await built;
  if (error) throw error;
  warnIfHitMaxRows(q.table, data?.length ?? 0);
  const rows = (data ?? []).map((row: Record<string, unknown>) =>
    hydrateTimestamps(row)
  ) as Record<string, unknown>[];
  return {
    docs: rows.map((row) => ({
      id: String(row.id ?? ""),
      data: () => row,
      get: (field: string) => row[field],
      exists: () => true,
      ref: {
        id: String(row.id ?? ""),
        table: q.table,
        // For collectionGroup("attendees") callers reading d.ref.parent.parent.id
        parent: { parent: { id: String(row.eventId ?? "") } },
      },
    })),
    size: rows.length,
    empty: rows.length === 0,
  };
}

// writeBatch + increment shims.
//
// DEPRECATED — do not add new callers. Unlike a real Firestore batch, commit()
// is NOT atomic: it issues sequential PostgREST writes, so a mid-batch failure
// leaves earlier writes applied. No callers remain in the codebase (the
// attendee flows all moved to single-transaction RPCs); multi-row writes that
// must be atomic belong in a Postgres RPC.
export function increment(n: number): { __increment: number } {
  return { __increment: n };
}

interface BatchOp {
  kind: "set" | "update" | "delete";
  table: string;
  id: string;
  data?: Record<string, unknown>;
  merge?: boolean;
}

export function writeBatch(): {
  set: (ref: { table: string; id: string }, data: Record<string, unknown>, options?: { merge?: boolean }) => void;
  update: (ref: { table: string; id: string }, data: Record<string, unknown>) => void;
  delete: (ref: { table: string; id: string }) => void;
  commit: () => Promise<void>;
} {
  const ops: BatchOp[] = [];
  return {
    set(ref, data, options) {
      ops.push({ kind: "set", table: ref.table, id: ref.id, data, merge: options?.merge });
    },
    update(ref, data) {
      ops.push({ kind: "update", table: ref.table, id: ref.id, data });
    },
    delete(ref) {
      ops.push({ kind: "delete", table: ref.table, id: ref.id });
    },
    async commit() {
      // Group writes by table for fewer round-trips. Increments need to be
      // resolved against current values, so do per-row updates for those.
      const supabase = getSupabaseBrowser();
      for (const op of ops) {
        if (op.kind === "delete") {
          const { error } = await supabase.from(op.table).delete().eq("id", op.id);
          if (error) throw error;
          continue;
        }
        const data = op.data ?? {};
        const hasIncrement = Object.values(data).some(
          (v) => v && typeof v === "object" && "__increment" in (v as object)
        );
        const prepared = prepareForWrite(data);
        if (hasIncrement) {
          // Read-modify-write fallback (no transaction) — racy on top of the
          // non-atomic commit; another reason this shim is deprecated.
          const { data: existing } = await supabase
            .from(op.table)
            .select("*")
            .eq("id", op.id)
            .maybeSingle();
          const resolved: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(data)) {
            if (v && typeof v === "object" && "__increment" in (v as object)) {
              const inc = (v as { __increment: number }).__increment;
              const cur = Number((existing as Record<string, unknown> | null)?.[k] ?? 0);
              resolved[k] = cur + inc;
            } else if (v instanceof Timestamp) {
              resolved[k] = v.toJSON();
            } else if (v instanceof Date) {
              resolved[k] = v.toISOString();
            } else {
              resolved[k] = (prepared as Record<string, unknown>)[k];
            }
          }
          const { error } = await supabase.from(op.table).update(resolved).eq("id", op.id);
          if (error) throw error;
        } else if (op.kind === "set") {
          const payload = { id: op.id, ...prepared };
          if (op.merge) {
            const { error } = await supabase.from(op.table).upsert(payload, { onConflict: "id" });
            if (error) throw error;
          } else {
            const { error } = await supabase.from(op.table).upsert(payload, { onConflict: "id" });
            if (error) throw error;
          }
        } else {
          const { error } = await supabase.from(op.table).update(prepared).eq("id", op.id);
          if (error) throw error;
        }
      }
    },
  };
}
