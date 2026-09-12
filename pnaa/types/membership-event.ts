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
