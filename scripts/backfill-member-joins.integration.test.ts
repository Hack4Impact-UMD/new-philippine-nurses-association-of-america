// Runs the backfill end to end against a real database: WA-shaped contacts in,
// rows in public.membership_events out, through PostgREST and the
// backfill_member_joins() RPC exactly as the CLI does.
//
// Needs a local Supabase stack with migrations applied (`supabase start`).
// Connection details come from TEST_DATABASE_URL, TEST_SUPABASE_URL,
// TEST_SUPABASE_SERVICE_ROLE_KEY and TEST_SUPABASE_ANON_KEY, or else from
// `supabase status`. With neither, the suite is skipped.

import { execSync } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { planJoinBackfill, writeJoinBackfill, type RpcClient } from "./member-joins.js";

interface Conn {
  dbUrl: string;
  apiUrl: string;
  serviceKey: string;
  anonKey: string;
}

function findLocalStack(): Conn | null {
  const env = process.env;
  if (env.TEST_DATABASE_URL && env.TEST_SUPABASE_URL && env.TEST_SUPABASE_SERVICE_ROLE_KEY) {
    return {
      dbUrl: env.TEST_DATABASE_URL,
      apiUrl: env.TEST_SUPABASE_URL,
      serviceKey: env.TEST_SUPABASE_SERVICE_ROLE_KEY,
      anonKey: env.TEST_SUPABASE_ANON_KEY ?? "",
    };
  }
  try {
    const out = execSync("supabase status -o json", {
      cwd: new URL("..", import.meta.url).pathname,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 15000,
    }).toString();
    const s = JSON.parse(out.slice(out.indexOf("{")));
    if (!s.DB_URL || !s.API_URL || !s.SERVICE_ROLE_KEY) return null;
    return { dbUrl: s.DB_URL, apiUrl: s.API_URL, serviceKey: s.SERVICE_ROLE_KEY, anonKey: s.ANON_KEY };
  } catch {
    return null;
  }
}

const conn = findLocalStack();
// Unique per run so a crashed run can't collide with the next one.
const P = `itest-backfill-${process.pid}-`;
const TODAY = "2026-11-13";

function waContact(id: string, memberSince: string | null, level: string | null = "Regular Member (1 year)") {
  return {
    Id: id,
    MembershipLevel: level ? { Name: level } : undefined,
    FieldValues: [
      { FieldName: "Archived", SystemCode: "IsArchived", Value: false },
      ...(memberSince
        ? [{ FieldName: "Member since", SystemCode: "MemberSince", Value: `${memberSince}T00:00:00-05:00` }]
        : []),
    ],
  };
}

describe.skipIf(!conn)("backfill_member_joins against the local database", () => {
  let db: pg.Client;
  let service: SupabaseClient;

  async function joinsFor(ids: string[]) {
    const { rows } = await db.query(
      `select "memberId", kind, "eventMonth"::text as month, "occurredAt"
         from public.membership_events
        where "memberId" = any($1)
        order by "memberId", kind`,
      [ids]
    );
    return rows as Array<{ memberId: string; kind: string; month: string; occurredAt: Date }>;
  }

  async function cleanup() {
    await db.query(`delete from public.members where id like $1`, [`${P}%`]);
  }

  beforeAll(async () => {
    db = new pg.Client({ connectionString: conn!.dbUrl });
    await db.connect();
    service = createClient(conn!.apiUrl, conn!.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  afterAll(async () => {
    await cleanup();
    await db.end();
  });

  beforeEach(async () => {
    await cleanup();
    // Lapsed on insert, so the trigger records nothing for these two.
    await db.query(
      `insert into public.members (id, name, email, "membershipLevel", "renewalDueDate", "activeStatus")
       values ($1, 'Old Timer', 'old@example.com', 'Regular Member (1 year)', '2020-01-01', 'Lapsed'),
              ($2, 'Mid Career', 'mid@example.com', 'Regular Member (1 year)', '2021-06-01', 'Lapsed')`,
      [`${P}old`, `${P}mid`]
    );
    // Active on insert: the trigger records a join stamped this month, which is
    // what every member synced since launch looks like.
    await db.query(
      `insert into public.members (id, name, email, "membershipLevel", "renewalDueDate", "activeStatus")
       values ($1, 'Recent Sync', 'recent@example.com', 'Regular Member (1 year)', '2099-01-01', 'Active')`,
      [`${P}recent`]
    );
    // A renewal the backfill must leave alone.
    await db.query(
      `insert into public.membership_events ("memberId", kind, "eventMonth") values ($1, 'renewed', '2026-10-01')`,
      [`${P}recent`]
    );
  });

  const contacts = () => [
    waContact(`${P}old`, "1998-07-04"),
    waContact(`${P}mid`, "2015-03-12"),
    waContact(`${P}recent`, "2012-11-30"),
    waContact(`${P}not-synced`, "2019-05-05"), // in WA, not yet in members
    waContact(`${P}registrant`, "2019-05-05", null), // not a member
    waContact(`${P}no-date`, null),
  ];

  it("precondition: the trigger recorded a join for the active member only", async () => {
    const rows = await joinsFor([`${P}old`, `${P}mid`, `${P}recent`]);
    expect(rows.filter((r) => r.kind === "joined").map((r) => r.memberId)).toEqual([`${P}recent`]);
  });

  it("a dry run reports exactly what would change and writes nothing", async () => {
    const before = await joinsFor([`${P}old`, `${P}mid`, `${P}recent`]);
    const plan = planJoinBackfill(contacts(), TODAY);
    const result = await writeJoinBackfill(service as unknown as RpcClient, plan.rows, { apply: false });

    expect(result).toEqual({
      dryRun: true,
      received: 4,
      ignored: 0,
      missingMember: 1,
      inserted: 2,
      updated: 1,
      unchanged: 0,
    });
    expect(await joinsFor([`${P}old`, `${P}mid`, `${P}recent`])).toEqual(before);
  });

  it("records each member as joined on their Wild Apricot start date", async () => {
    const plan = planJoinBackfill(contacts(), TODAY);
    expect(plan.skipped).toEqual({ archived: 0, notMember: 1, noStartDate: 1, outOfRange: 0 });

    const result = await writeJoinBackfill(service as unknown as RpcClient, plan.rows, { apply: true });
    expect(result).toMatchObject({ dryRun: false, inserted: 2, updated: 1, missingMember: 1, unchanged: 0 });

    const rows = await joinsFor([`${P}old`, `${P}mid`, `${P}recent`, `${P}not-synced`]);
    expect(rows.map((r) => [r.memberId, r.kind, r.month, r.occurredAt.toISOString()])).toEqual([
      [`${P}mid`, "joined", "2015-03-01", "2015-03-12T12:00:00.000Z"],
      [`${P}old`, "joined", "1998-07-01", "1998-07-04T12:00:00.000Z"],
      // The trigger's sync-day join moved to the real date; the renewal kept.
      [`${P}recent`, "joined", "2012-11-01", "2012-11-30T12:00:00.000Z"],
      [`${P}recent`, "renewed", "2026-10-01", expect.any(String)],
    ]);
  });

  it("is idempotent: a second run changes nothing", async () => {
    const plan = planJoinBackfill(contacts(), TODAY);
    await writeJoinBackfill(service as unknown as RpcClient, plan.rows, { apply: true });
    const after = await joinsFor([`${P}old`, `${P}mid`, `${P}recent`]);

    const again = await writeJoinBackfill(service as unknown as RpcClient, plan.rows, { apply: true });
    expect(again).toMatchObject({ inserted: 0, updated: 0, unchanged: 3, missingMember: 1 });
    expect(await joinsFor([`${P}old`, `${P}mid`, `${P}recent`])).toEqual(after);
  });

  it("keeps one join per member, at the earliest date, when a batch repeats a member", async () => {
    const { data, error } = await service.rpc("backfill_member_joins", {
      p_rows: [
        { memberId: `${P}old`, joinedOn: "2001-01-01" },
        { memberId: `${P}old`, joinedOn: "1999-09-09" },
        { memberId: "", joinedOn: "2001-01-01" },
        { memberId: `${P}mid`, joinedOn: null },
      ],
      p_dry_run: false,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ received: 4, ignored: 3, inserted: 1 });
    const rows = await joinsFor([`${P}old`]);
    expect(rows.map((r) => r.month)).toEqual(["1999-09-01"]);
  });

  it("splits across batches the same as one call", async () => {
    const plan = planJoinBackfill(contacts(), TODAY);
    const result = await writeJoinBackfill(service as unknown as RpcClient, plan.rows, {
      apply: true,
      batchSize: 1,
    });
    expect(result).toMatchObject({ received: 4, inserted: 2, updated: 1, missingMember: 1 });
  });

  it("rejects a payload that is not an array", async () => {
    const { error } = await service.rpc("backfill_member_joins", { p_rows: { memberId: "x" }, p_dry_run: true });
    expect(error?.message).toMatch(/must be a JSON array/);
  });

  it.skipIf(!conn?.anonKey)("cannot be called by the anon key", async () => {
    const anon = createClient(conn!.apiUrl, conn!.anonKey, { auth: { persistSession: false } });
    const { error } = await anon.rpc("backfill_member_joins", {
      p_rows: [{ memberId: `${P}old`, joinedOn: "1990-01-01" }],
      p_dry_run: false,
    });
    expect(error).not.toBeNull();
    expect(await joinsFor([`${P}old`])).toEqual([]);
  });

  it("cannot be called by a signed-in admin either", async () => {
    await db.query("begin");
    try {
      await db.query("set local role authenticated");
      await db.query(
        `select set_config('request.jwt.claims', $1, true)`,
        [JSON.stringify({ role: "authenticated", app_metadata: { user_role: "national_admin" } })]
      );
      await expect(
        db.query(`select public.backfill_member_joins('[]'::jsonb, true)`)
      ).rejects.toThrow(/permission denied/);
    } finally {
      await db.query("rollback");
    }
  });

  it("puts backfilled members in the admin list for the month they joined", async () => {
    const plan = planJoinBackfill(contacts(), TODAY);
    await writeJoinBackfill(service as unknown as RpcClient, plan.rows, { apply: true });

    await db.query("begin");
    try {
      await db.query("set local role authenticated");
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ role: "authenticated", app_metadata: { user_role: "national_admin" } }),
      ]);
      const { rows } = await db.query(
        `select public.member_joins_and_renewals('2015-03-20'::date, 'national', null) as list`
      );
      const ours = (rows[0].list as Array<Record<string, unknown>>).filter((r) =>
        String(r.memberId).startsWith(P)
      );
      expect(ours).toEqual([
        expect.objectContaining({
          memberId: `${P}mid`,
          name: "Mid Career",
          kind: "joined",
          occurredAt: "2015-03-12T12:00:00+00:00",
        }),
      ]);
    } finally {
      await db.query("rollback");
    }
  });
});
