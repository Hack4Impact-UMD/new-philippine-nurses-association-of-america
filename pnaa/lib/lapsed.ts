/**
 * How long a lapsed member has been lapsed, grouped the way the outreach lists
 * are worked: the last 30 days, 31–60, 61–90, and beyond 90.
 *
 * The `lapsed_members` RPC returns the raw day count; this is the one place the
 * boundaries are drawn, so the filter buttons, the badge and the counts can't
 * disagree.
 */
export type LapsedBucket = "0-30" | "31-60" | "61-90" | "90+";

export const LAPSED_BUCKETS: readonly LapsedBucket[] = [
  "0-30",
  "31-60",
  "61-90",
  "90+",
] as const;

export const LAPSED_BUCKET_LABEL: Record<LapsedBucket, string> = {
  "0-30": "≤30 days",
  "31-60": "31–60 days",
  "61-90": "61–90 days",
  "90+": "90+ days",
};

export function lapsedBucket(daysLapsed: number): LapsedBucket {
  if (daysLapsed <= 30) return "0-30";
  if (daysLapsed <= 60) return "31-60";
  if (daysLapsed <= 90) return "61-90";
  return "90+";
}

export function countByBucket(
  rows: readonly { daysLapsed: number }[]
): Record<LapsedBucket, number> {
  const counts: Record<LapsedBucket, number> = {
    "0-30": 0,
    "31-60": 0,
    "61-90": 0,
    "90+": 0,
  };
  for (const r of rows) counts[lapsedBucket(r.daysLapsed)]++;
  return counts;
}
