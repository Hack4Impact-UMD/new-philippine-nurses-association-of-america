import { describe, expect, it, vi } from "vitest";
import { extractMemberSince } from "./wa-utils.js";
import {
  orgToday,
  planJoinBackfill,
  writeJoinBackfill,
  type JoinBackfillResult,
  type JoinBackfillRow,
  type RpcClient,
} from "./member-joins.js";

const TODAY = "2026-11-13";

/** A WA contact shaped like the Contacts API returns it. */
function contact({
  id = 1001,
  level = "Regular Member (1 year)" as string | null,
  memberSince = "2015-03-12T00:00:00-05:00" as unknown,
  memberSinceField = { FieldName: "Member since", SystemCode: "MemberSince" } as {
    FieldName: string;
    SystemCode?: string;
  } | null,
  archived = false,
} = {}): Record<string, unknown> {
  const fieldValues: Array<Record<string, unknown>> = [
    { FieldName: "Archived", SystemCode: "IsArchived", Value: archived },
    { FieldName: "Renewal due", SystemCode: "RenewalDue", Value: "2027-03-12" },
  ];
  if (memberSinceField) fieldValues.push({ ...memberSinceField, Value: memberSince });
  return {
    Id: id,
    FirstName: "Test",
    LastName: "Member",
    MembershipLevel: level === null ? undefined : { Id: 1, Name: level },
    FieldValues: fieldValues,
  };
}

describe("extractMemberSince", () => {
  it("keeps the calendar date of an offset timestamp, ignoring the zone", () => {
    // Converting through Date would put midnight EST on 2015-03-12 in UTC on
    // the same day, but midnight +10:00 would land on the 11th. Neither moves.
    expect(
      extractMemberSince([
        { FieldName: "Member since", SystemCode: "MemberSince", Value: "2015-03-12T00:00:00-05:00" },
      ])
    ).toBe("2015-03-12");
    expect(
      extractMemberSince([
        { FieldName: "Member since", SystemCode: "MemberSince", Value: "2015-03-12T00:00:00+10:00" },
      ])
    ).toBe("2015-03-12");
  });

  it("accepts a bare date and a timestamp without offset", () => {
    expect(extractMemberSince([{ FieldName: "Member since", Value: "1999-12-31" }])).toBe(
      "1999-12-31"
    );
    expect(
      extractMemberSince([{ FieldName: "Member since", Value: "2001-01-02T09:30:00" }])
    ).toBe("2001-01-02");
  });

  it("finds the field by system code when an admin has renamed its label", () => {
    expect(
      extractMemberSince([
        { FieldName: "Joined PNAA", SystemCode: "MemberSince", Value: "2010-06-01T00:00:00" },
      ])
    ).toBe("2010-06-01");
  });

  it("prefers the system code over a custom field that happens to share the label", () => {
    expect(
      extractMemberSince([
        { FieldName: "Member since", SystemCode: "custom-123", Value: "2020-01-01" },
        { FieldName: "Start", SystemCode: "MemberSince", Value: "2011-01-01" },
      ])
    ).toBe("2011-01-01");
  });

  it.each([
    ["missing field", []],
    ["null value", [{ FieldName: "Member since", Value: null }]],
    ["empty string", [{ FieldName: "Member since", Value: "" }]],
    ["non-ISO text", [{ FieldName: "Member since", Value: "03/12/2015" }]],
    ["object value", [{ FieldName: "Member since", Value: { Label: "2015-03-12" } }]],
    ["impossible day", [{ FieldName: "Member since", Value: "2021-02-30T00:00:00" }]],
    ["impossible month", [{ FieldName: "Member since", Value: "2021-13-01" }]],
  ])("returns null for %s", (_label, fields) => {
    expect(extractMemberSince(fields as never)).toBeNull();
  });

  it("accepts a leap day only in a leap year", () => {
    expect(extractMemberSince([{ FieldName: "Member since", Value: "2020-02-29" }])).toBe(
      "2020-02-29"
    );
    expect(extractMemberSince([{ FieldName: "Member since", Value: "2021-02-29" }])).toBeNull();
  });
});

describe("planJoinBackfill", () => {
  it("plans one join per member, keyed by WA contact id", () => {
    const plan = planJoinBackfill(
      [contact({ id: 1, memberSince: "2015-03-12T00:00:00-05:00" }), contact({ id: 2, memberSince: "1998-07-04" })],
      TODAY
    );
    expect(plan.rows).toEqual([
      { memberId: "1", joinedOn: "2015-03-12" },
      { memberId: "2", joinedOn: "1998-07-04" },
    ]);
    expect(plan.contacts).toBe(2);
    expect(plan.byYear).toEqual({ "2015": 1, "1998": 1 });
  });

  it("skips contacts without a membership level, as the join trigger does", () => {
    const plan = planJoinBackfill(
      [contact({ id: 1, level: null }), contact({ id: 2, level: "  " }), contact({ id: 3 })],
      TODAY
    );
    expect(plan.rows.map((r) => r.memberId)).toEqual(["3"]);
    expect(plan.skipped.notMember).toBe(2);
  });

  it("skips archived contacts", () => {
    const plan = planJoinBackfill([contact({ id: 1, archived: true })], TODAY);
    expect(plan.rows).toEqual([]);
    expect(plan.skipped.archived).toBe(1);
  });

  it("counts members with no usable start date", () => {
    const plan = planJoinBackfill(
      [
        contact({ id: 1, memberSinceField: null }),
        contact({ id: 2, memberSince: null }),
        contact({ id: 3, memberSince: "not a date" }),
      ],
      TODAY
    );
    expect(plan.rows).toEqual([]);
    expect(plan.skipped.noStartDate).toBe(3);
  });

  it("rejects start dates in the future or before 1975 (incl. the 1900-01-01 placeholder), but keeps today and 1975-01-01", () => {
    const plan = planJoinBackfill(
      [
        contact({ id: 1, memberSince: "2026-11-14" }),
        contact({ id: 2, memberSince: "1974-12-31" }),
        contact({ id: 5, memberSince: "1900-01-01" }),
        contact({ id: 3, memberSince: TODAY }),
        contact({ id: 4, memberSince: "1975-01-01" }),
      ],
      TODAY
    );
    expect(plan.rows.map((r) => r.memberId)).toEqual(["3", "4"]);
    expect(plan.skipped.outOfRange).toBe(3);
  });

  it("includes lapsed members, since they did join", () => {
    const lapsed = contact({ id: 9 });
    (lapsed.FieldValues as Array<Record<string, unknown>>)[1].Value = "2019-01-01";
    expect(planJoinBackfill([lapsed], TODAY).rows).toEqual([
      { memberId: "9", joinedOn: "2015-03-12" },
    ]);
  });

  it("handles a contact with no FieldValues at all", () => {
    const plan = planJoinBackfill([{ Id: 5, MembershipLevel: { Name: "Regular" } }], TODAY);
    expect(plan.skipped.noStartDate).toBe(1);
  });
});

describe("orgToday", () => {
  it("uses New York's date, not UTC's", () => {
    // 03:00 UTC on Nov 14 is still Nov 13 in New York.
    expect(orgToday(new Date("2026-11-14T03:00:00Z"))).toBe("2026-11-13");
    expect(orgToday(new Date("2026-11-14T06:00:00Z"))).toBe("2026-11-14");
  });
});

describe("writeJoinBackfill", () => {
  function fakeClient(
    respond: (rows: JoinBackfillRow[], dryRun: boolean) => Partial<JoinBackfillResult> | Error
  ) {
    const rpc = vi.fn((_fn: string, args: { p_rows: JoinBackfillRow[]; p_dry_run: boolean }) => {
      const r = respond(args.p_rows, args.p_dry_run);
      if (r instanceof Error) return Promise.resolve({ data: null, error: { message: r.message } });
      return Promise.resolve({
        data: {
          dryRun: args.p_dry_run,
          received: args.p_rows.length,
          ignored: 0,
          missingMember: 0,
          inserted: 0,
          updated: 0,
          unchanged: 0,
          ...r,
        },
        error: null,
      });
    });
    return { client: { rpc } as unknown as RpcClient, rpc };
  }

  const rows = Array.from({ length: 5 }, (_, i) => ({
    memberId: String(i),
    joinedOn: "2015-01-01",
  }));

  it("is a dry run unless apply is set", async () => {
    const { client, rpc } = fakeClient((r) => ({ inserted: r.length }));
    const result = await writeJoinBackfill(client, rows, { apply: false });
    expect(rpc).toHaveBeenCalledWith("backfill_member_joins", { p_rows: rows, p_dry_run: true });
    expect(result.dryRun).toBe(true);
  });

  it("writes when apply is set", async () => {
    const { client, rpc } = fakeClient((r) => ({ inserted: r.length }));
    await writeJoinBackfill(client, rows, { apply: true });
    expect(rpc.mock.calls[0][1].p_dry_run).toBe(false);
  });

  it("splits rows into batches and totals every count", async () => {
    const { client, rpc } = fakeClient((r) => ({
      inserted: 1,
      updated: 1,
      unchanged: r.length - 2 > 0 ? r.length - 2 : 0,
      missingMember: 0,
    }));
    const result = await writeJoinBackfill(client, rows, { apply: true, batchSize: 2 });
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc.mock.calls.map((c) => c[1].p_rows.length)).toEqual([2, 2, 1]);
    expect(result).toEqual({
      dryRun: false,
      received: 5,
      ignored: 0,
      missingMember: 0,
      inserted: 3,
      updated: 3,
      unchanged: 0,
    });
  });

  it("stops at the first failing batch and says where", async () => {
    let call = 0;
    const { client, rpc } = fakeClient(() => (++call === 2 ? new Error("boom") : {}));
    await expect(writeJoinBackfill(client, rows, { apply: true, batchSize: 2 })).rejects.toThrow(
      "backfill_member_joins failed at row 2: boom"
    );
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("makes no calls for an empty plan", async () => {
    const { client, rpc } = fakeClient(() => ({}));
    const result = await writeJoinBackfill(client, [], { apply: true });
    expect(rpc).not.toHaveBeenCalled();
    expect(result.received).toBe(0);
  });
});
