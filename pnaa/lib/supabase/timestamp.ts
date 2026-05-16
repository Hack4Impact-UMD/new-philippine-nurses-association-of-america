// Shim of firebase/firestore Timestamp so existing call sites (.toDate(), .toMillis(),
// .seconds, etc.) keep working with Postgres timestamptz values returned as ISO strings.

export class Timestamp {
  readonly seconds: number;
  readonly nanoseconds: number;

  constructor(seconds: number, nanoseconds: number) {
    this.seconds = seconds;
    this.nanoseconds = nanoseconds;
  }

  static now(): Timestamp {
    return Timestamp.fromMillis(Date.now());
  }

  static fromDate(date: Date): Timestamp {
    return Timestamp.fromMillis(date.getTime());
  }

  static fromMillis(ms: number): Timestamp {
    const seconds = Math.floor(ms / 1000);
    const nanoseconds = (ms - seconds * 1000) * 1_000_000;
    return new Timestamp(seconds, nanoseconds);
  }

  /** Accept ISO string, Date, number (ms), or anything Timestamp-shaped. */
  static fromAny(value: unknown): Timestamp | null {
    if (value == null) return null;
    if (value instanceof Timestamp) return value;
    if (value instanceof Date) return Timestamp.fromDate(value);
    if (typeof value === "number") return Timestamp.fromMillis(value);
    if (typeof value === "string") {
      const ms = Date.parse(value);
      if (Number.isNaN(ms)) return null;
      return Timestamp.fromMillis(ms);
    }
    if (typeof value === "object") {
      const v = value as { seconds?: number; nanoseconds?: number; _seconds?: number; _nanoseconds?: number };
      const s = v.seconds ?? v._seconds;
      const n = v.nanoseconds ?? v._nanoseconds ?? 0;
      if (typeof s === "number") return new Timestamp(s, n);
    }
    return null;
  }

  toDate(): Date {
    return new Date(this.seconds * 1000 + Math.floor(this.nanoseconds / 1_000_000));
  }

  toMillis(): number {
    return this.seconds * 1000 + Math.floor(this.nanoseconds / 1_000_000);
  }

  toJSON(): string {
    return this.toDate().toISOString();
  }

  toString(): string {
    return this.toDate().toISOString();
  }

  isEqual(other: Timestamp): boolean {
    return this.seconds === other.seconds && this.nanoseconds === other.nanoseconds;
  }
}

/** serverTimestamp() shim — returns a sentinel that the boundary translator
 *  converts to `null` (so Postgres defaults / `now()` triggers fire). */
const SERVER_TIMESTAMP_SENTINEL = Symbol("serverTimestamp");

export function serverTimestamp(): { __sentinel: typeof SERVER_TIMESTAMP_SENTINEL } {
  return { __sentinel: SERVER_TIMESTAMP_SENTINEL };
}

export function isServerTimestamp(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { __sentinel?: symbol }).__sentinel === SERVER_TIMESTAMP_SENTINEL
  );
}

/** Hydrate any timestamptz-looking strings in a row into Timestamp instances. */
const TIMESTAMP_FIELD_REGEX = /(Date|At|Time|TimeStamp|timestamp|Updated|Created|Login|Synced)$/;

export function hydrateTimestamps<T>(row: T): T {
  if (row == null || typeof row !== "object") return row;
  if (Array.isArray(row)) return row.map(hydrateTimestamps) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
    if (
      typeof value === "string" &&
      TIMESTAMP_FIELD_REGEX.test(key) &&
      /^\d{4}-\d{2}-\d{2}T/.test(value)
    ) {
      const ts = Timestamp.fromAny(value);
      out[key] = ts ?? value;
    } else if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
      out[key] = hydrateTimestamps(value);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

/** Inverse: serialize Timestamp/Date into ISO strings for inserts/updates. */
export function serializeTimestamps<T>(row: T): T {
  if (row == null || typeof row !== "object") return row;
  if (Array.isArray(row)) return row.map(serializeTimestamps) as unknown as T;
  if (row instanceof Timestamp) return row.toJSON() as unknown as T;
  if (row instanceof Date) return row.toISOString() as unknown as T;
  if (isServerTimestamp(row)) return null as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
    if (value instanceof Timestamp) out[key] = value.toJSON();
    else if (value instanceof Date) out[key] = value.toISOString();
    else if (isServerTimestamp(value)) {
      // Drop server-timestamp sentinels — Postgres default (now()) handles it.
      continue;
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = serializeTimestamps(value);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}
