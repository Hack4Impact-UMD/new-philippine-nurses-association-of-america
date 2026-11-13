import { describe, expect, it } from "vitest";
import { countByBucket, lapsedBucket } from "./lapsed";

describe("lapsedBucket", () => {
  it.each([
    [0, "0-30"],
    [1, "0-30"],
    [30, "0-30"],
    [31, "31-60"],
    [60, "31-60"],
    [61, "61-90"],
    [90, "61-90"],
    [91, "90+"],
    [400, "90+"],
  ] as const)("%i days lapsed → %s", (days, bucket) => {
    expect(lapsedBucket(days)).toBe(bucket);
  });
});

describe("countByBucket", () => {
  it("counts every row into exactly one bucket", () => {
    const rows = [0, 30, 31, 45, 60, 61, 90, 91, 365].map((daysLapsed) => ({
      daysLapsed,
    }));
    expect(countByBucket(rows)).toEqual({
      "0-30": 2,
      "31-60": 3,
      "61-90": 2,
      "90+": 2,
    });
  });

  it("returns zeros for no rows", () => {
    expect(countByBucket([])).toEqual({
      "0-30": 0,
      "31-60": 0,
      "61-90": 0,
      "90+": 0,
    });
  });
});
