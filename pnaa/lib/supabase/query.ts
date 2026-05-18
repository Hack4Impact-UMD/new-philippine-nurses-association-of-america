// Drop-in compatible Firestore-style query constraint helpers.
// Components keep writing `where("archived", "==", false)` etc — we translate
// those constraint objects into Supabase PostgREST query calls.

import type { PostgrestFilterBuilder, PostgrestTransformBuilder } from "@supabase/postgrest-js";

export type WhereOp =
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "in"
  | "not-in"
  | "array-contains"
  | "array-contains-any"
  // Postgres-specific (no Firestore equivalent). `value` is the LIKE pattern
  // including any % wildcards the caller wants.
  | "like"
  | "ilike";

export interface WhereConstraint {
  __kind: "where";
  field: string;
  op: WhereOp;
  value: unknown;
}

export interface OrderByConstraint {
  __kind: "orderBy";
  field: string;
  direction: "asc" | "desc";
}

export interface LimitConstraint {
  __kind: "limit";
  count: number;
}

export interface StartAfterConstraintCarrier {
  __kind: "startAfter";
  // Cursor row (or null for the first page). Resolved client-side at apply time.
  cursor: { data: () => Record<string, unknown>; get: (field: string) => unknown } | null;
}

export type QueryConstraint =
  | WhereConstraint
  | OrderByConstraint
  | LimitConstraint
  | StartAfterConstraintCarrier;

export function where(field: string, op: WhereOp, value: unknown): WhereConstraint {
  return { __kind: "where", field, op, value };
}

export function orderBy(field: string, direction: "asc" | "desc" = "asc"): OrderByConstraint {
  return { __kind: "orderBy", field, direction };
}

export function limit(count: number): LimitConstraint {
  return { __kind: "limit", count };
}

type AnyFilter =
  | // eslint-disable-next-line @typescript-eslint/no-explicit-any
PostgrestFilterBuilder<any, any, any, any>
  | // eslint-disable-next-line @typescript-eslint/no-explicit-any
PostgrestTransformBuilder<any, any, any, any>;

/** Apply a list of constraints to a Supabase query. */
export function applyConstraints<T extends AnyFilter>(
  builder: T,
  constraints: QueryConstraint[]
): T {
  // Resolve startAfter into a synthetic where() against the first orderBy field.
  const orderBys = constraints.filter((c): c is OrderByConstraint => c.__kind === "orderBy");
  const startAfters = constraints.filter(
    (c): c is StartAfterConstraintCarrier => c.__kind === "startAfter"
  );
  const synthetic: QueryConstraint[] = [];
  for (const sa of startAfters) {
    if (!sa.cursor) continue;
    const ob = orderBys[0];
    if (!ob) continue;
    const cursorValue = sa.cursor.get(ob.field);
    synthetic.push({
      __kind: "where",
      field: ob.field,
      op: ob.direction === "asc" ? ">" : "<",
      value: cursorValue,
    });
  }
  const effective: QueryConstraint[] = [
    ...constraints.filter((c) => c.__kind !== "startAfter"),
    ...synthetic,
  ];

  let q: AnyFilter = builder;
  for (const c of effective) {
    if (c.__kind === "where") {
      switch (c.op) {
        case "==":
          q = (q as // eslint-disable-next-line @typescript-eslint/no-explicit-any
PostgrestFilterBuilder<any, any, any, any>).eq(c.field, c.value as never);
          break;
        case "!=":
          q = (q as // eslint-disable-next-line @typescript-eslint/no-explicit-any
PostgrestFilterBuilder<any, any, any, any>).neq(c.field, c.value as never);
          break;
        case "<":
          q = (q as // eslint-disable-next-line @typescript-eslint/no-explicit-any
PostgrestFilterBuilder<any, any, any, any>).lt(c.field, c.value as never);
          break;
        case "<=":
          q = (q as // eslint-disable-next-line @typescript-eslint/no-explicit-any
PostgrestFilterBuilder<any, any, any, any>).lte(c.field, c.value as never);
          break;
        case ">":
          q = (q as // eslint-disable-next-line @typescript-eslint/no-explicit-any
PostgrestFilterBuilder<any, any, any, any>).gt(c.field, c.value as never);
          break;
        case ">=":
          q = (q as // eslint-disable-next-line @typescript-eslint/no-explicit-any
PostgrestFilterBuilder<any, any, any, any>).gte(c.field, c.value as never);
          break;
        case "in":
          q = (q as // eslint-disable-next-line @typescript-eslint/no-explicit-any
PostgrestFilterBuilder<any, any, any, any>).in(
            c.field,
            (c.value as unknown[]) ?? []
          );
          break;
        case "not-in":
          q = (q as // eslint-disable-next-line @typescript-eslint/no-explicit-any
PostgrestFilterBuilder<any, any, any, any>).not(
            c.field,
            "in",
            `(${((c.value as unknown[]) ?? []).map((v) => JSON.stringify(v)).join(",")})`
          );
          break;
        case "array-contains":
          q = (q as // eslint-disable-next-line @typescript-eslint/no-explicit-any
PostgrestFilterBuilder<any, any, any, any>).contains(c.field, [c.value]);
          break;
        case "array-contains-any":
          q = (q as // eslint-disable-next-line @typescript-eslint/no-explicit-any
PostgrestFilterBuilder<any, any, any, any>).overlaps(
            c.field,
            (c.value as unknown[]) ?? []
          );
          break;
        case "like":
          q = (q as // eslint-disable-next-line @typescript-eslint/no-explicit-any
PostgrestFilterBuilder<any, any, any, any>).like(c.field, String(c.value));
          break;
        case "ilike":
          q = (q as // eslint-disable-next-line @typescript-eslint/no-explicit-any
PostgrestFilterBuilder<any, any, any, any>).ilike(c.field, String(c.value));
          break;
      }
    } else if (c.__kind === "orderBy") {
      q = (q as // eslint-disable-next-line @typescript-eslint/no-explicit-any
PostgrestTransformBuilder<any, any, any, any>).order(c.field, {
        ascending: c.direction === "asc",
      });
    } else if (c.__kind === "limit") {
      q = (q as // eslint-disable-next-line @typescript-eslint/no-explicit-any
PostgrestTransformBuilder<any, any, any, any>).limit(c.count);
    }
  }
  return q as T;
}

/** Build a Realtime filter string from a where constraint, if possible. */
export function buildRealtimeFilter(constraints: QueryConstraint[]): string | undefined {
  // postgres_changes supports only a single eq-style filter, so pick the first
  // exact-match where() and fall back to client-side filtering for the rest.
  const exact = constraints.find(
    (c): c is WhereConstraint => c.__kind === "where" && c.op === "=="
  );
  if (!exact) return undefined;
  return `${exact.field}=eq.${exact.value}`;
}

/** Predicate that mirrors a where constraint on a hydrated row, for client-side filtering. */
export function rowMatches(row: Record<string, unknown>, constraints: QueryConstraint[]): boolean {
  for (const c of constraints) {
    if (c.__kind !== "where") continue;
    const v = row[c.field];
    switch (c.op) {
      case "==": if (v !== c.value) return false; break;
      case "!=": if (v === c.value) return false; break;
      case "<":  if (!(typeof v === "number" && typeof c.value === "number" && v < c.value)) return false; break;
      case "<=": if (!(typeof v === "number" && typeof c.value === "number" && v <= c.value)) return false; break;
      case ">":  if (!(typeof v === "number" && typeof c.value === "number" && v > c.value)) return false; break;
      case ">=": if (!(typeof v === "number" && typeof c.value === "number" && v >= c.value)) return false; break;
      case "in":     if (!Array.isArray(c.value) || !(c.value as unknown[]).includes(v)) return false; break;
      case "not-in": if (Array.isArray(c.value) && (c.value as unknown[]).includes(v)) return false; break;
      case "array-contains":     if (!(Array.isArray(v) && v.includes(c.value))) return false; break;
      case "array-contains-any": if (!(Array.isArray(v) && Array.isArray(c.value) && (c.value as unknown[]).some((x) => v.includes(x)))) return false; break;
      case "like":
      case "ilike": {
        if (typeof v !== "string") return false;
        const pattern = String(c.value);
        const re = new RegExp(
          "^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".") + "$",
          c.op === "ilike" ? "i" : ""
        );
        if (!re.test(v)) return false;
        break;
      }
    }
  }
  return true;
}
