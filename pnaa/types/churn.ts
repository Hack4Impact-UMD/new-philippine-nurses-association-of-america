/**
 * One month of the churn trend, as returned by the `churn_trend` RPC.
 *
 * Churn is measured forward from the day capture was deployed — see
 * supabase/migrations/20260911000001_churn_capture.sql. Months before that have
 * no recorded base, which is why `base` and `churnRate` are nullable: a zero
 * there would claim "we lost nobody" rather than "we weren't measuring yet".
 */
export interface ChurnPoint {
  /** First day of the month, YYYY-MM-DD. */
  month: string;
  /** Active → Lapsed transitions during the month. */
  lapsed: number;
  /** Lapsed → Active transitions during the month. */
  reactivated: number;
  /** Active members at the start of the month. Null before capture began. */
  base: number | null;
  /** Fraction, not percent. Null when the base is unknown or zero. */
  churnRate: number | null;
}

export type ChurnScopeType = "national" | "region" | "chapter";
