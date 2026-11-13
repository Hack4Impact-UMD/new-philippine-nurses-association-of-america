// Planning and writing for the one-time join-date backfill. The CLI wrapper is
// backfill-member-joins.ts; this module holds the logic so it can be tested
// without Wild Apricot or a database.

import { extractMemberSince } from "./wa-utils.js";

/** One row for public.backfill_member_joins(). */
export interface JoinBackfillRow {
  /** public.members.id, which is always the WA contact id. */
  memberId: string;
  /** YYYY-MM-DD. */
  joinedOn: string;
}

export interface JoinBackfillPlan {
  rows: JoinBackfillRow[];
  contacts: number;
  skipped: {
    archived: number;
    /** No membership level: an event registrant or donor, never a member. */
    notMember: number;
    /** "Member since" missing or not a date. */
    noStartDate: number;
    /** Before 1975 or after today, so a data-entry error rather than a join. */
    outOfRange: number;
  };
  /** Count of planned joins per year, for eyeballing a dry run. */
  byYear: Record<string, number>;
}

// PNAA was founded in 1979. Wild Apricot often holds 1900-01-01 as a
// placeholder, so a floor at 1900 would let those through as real joins.
export const EARLIEST_START_DATE = "1975-01-01";

type FieldValue = { FieldName: string; Value: unknown; SystemCode?: string };

/** Today's date on the org's clock, as YYYY-MM-DD. */
export function orgToday(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Decide which contacts get a 'joined' event and on what date. Uses the same
 * member test as the join trigger: a contact counts only if it has a
 * membership level. Lapsed members are included, because they did join.
 */
export function planJoinBackfill(
  contacts: Record<string, unknown>[],
  today: string
): JoinBackfillPlan {
  const plan: JoinBackfillPlan = {
    rows: [],
    contacts: contacts.length,
    skipped: { archived: 0, notMember: 0, noStartDate: 0, outOfRange: 0 },
    byYear: {},
  };

  for (const contact of contacts) {
    const fieldValues = (contact.FieldValues as FieldValue[] | undefined) ?? [];
    if (fieldValues.find((f) => f.FieldName === "Archived")?.Value === true) {
      plan.skipped.archived++;
      continue;
    }

    const level = contact.MembershipLevel as { Name?: unknown } | null | undefined;
    const levelName = level && typeof level === "object" ? String(level.Name ?? "").trim() : "";
    const memberId = String(contact.Id ?? "").trim();
    if (!levelName || !memberId) {
      plan.skipped.notMember++;
      continue;
    }

    const joinedOn = extractMemberSince(fieldValues);
    if (!joinedOn) {
      plan.skipped.noStartDate++;
      continue;
    }
    // ISO dates compare correctly as strings.
    if (joinedOn < EARLIEST_START_DATE || joinedOn > today) {
      plan.skipped.outOfRange++;
      continue;
    }

    plan.rows.push({ memberId, joinedOn });
    const year = joinedOn.slice(0, 4);
    plan.byYear[year] = (plan.byYear[year] ?? 0) + 1;
  }

  return plan;
}

/** What public.backfill_member_joins() reports for one batch. */
export interface JoinBackfillResult {
  dryRun: boolean;
  received: number;
  ignored: number;
  missingMember: number;
  inserted: number;
  updated: number;
  unchanged: number;
}

/** The slice of a Supabase client this module needs. */
export interface RpcClient {
  rpc(
    fn: "backfill_member_joins",
    args: { p_rows: JoinBackfillRow[]; p_dry_run: boolean }
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/**
 * Send the planned rows in batches and total the results. A dry run asks the
 * database what it would do without writing, so the counts are exact either way.
 */
export async function writeJoinBackfill(
  client: RpcClient,
  rows: JoinBackfillRow[],
  { apply, batchSize = 1000 }: { apply: boolean; batchSize?: number }
): Promise<JoinBackfillResult> {
  const total: JoinBackfillResult = {
    dryRun: !apply,
    received: 0,
    ignored: 0,
    missingMember: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
  };

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { data, error } = await client.rpc("backfill_member_joins", {
      p_rows: batch,
      p_dry_run: !apply,
    });
    if (error) {
      throw new Error(`backfill_member_joins failed at row ${i}: ${error.message}`);
    }
    const r = data as JoinBackfillResult;
    total.received += r.received;
    total.ignored += r.ignored;
    total.missingMember += r.missingMember;
    total.inserted += r.inserted;
    total.updated += r.updated;
    total.unchanged += r.unchanged;
  }

  return total;
}
