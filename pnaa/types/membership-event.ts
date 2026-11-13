export type MembershipEventKind = "joined" | "renewed";

/**
 * One row of the monthly new / renewed member list, as returned by the
 * `member_joins_and_renewals` RPC. Recorded from launch onward only — see
 * supabase/migrations/20260912000001_membership_events.sql.
 */
export interface MembershipEventRow {
  memberId: string;
  name: string | null;
  email: string | null;
  membershipLevel: string | null;
  /** The member's current chapter, not the one they were in when it happened. */
  chapterId: string | null;
  /** Null when the caller can't read the chapter row itself. */
  chapterName: string | null;
  region: string | null;
  kind: MembershipEventKind;
  occurredAt: string;
}

/**
 * One row of the lapsed member list, as returned by the `lapsed_members` RPC —
 * see supabase/migrations/20261113000001_lapsed_members.sql. Bucket it with
 * `lapsedBucket()` from lib/lapsed.ts.
 */
export interface LapsedMemberRow {
  memberId: string;
  name: string | null;
  email: string | null;
  membershipLevel: string | null;
  chapterId: string | null;
  /** Null when the caller can't read the chapter row itself. */
  chapterName: string | null;
  region: string | null;
  /** The renewal due date that passed, YYYY-MM-DD. */
  lapsedOn: string;
  /** Whole days since `lapsedOn` on the org's (America/New_York) calendar. Never negative. */
  daysLapsed: number;
}
