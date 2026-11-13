// One-time import of member start dates from Wild Apricot.
//
// Reads every non-archived contact's "Member since" date and records each
// member as joined on that date in public.membership_events, so the
// New & Renewed Members list covers members who joined before launch. Joins the
// nightly trigger already recorded are moved to the Wild Apricot date.
//
// Run the nightly sync first: a contact with no row in public.members is
// skipped and counted as missingMember.
//
//   npm run backfill-member-joins            # dry run: reports, writes nothing
//   npm run backfill-member-joins -- --apply # writes
//
// Safe to re-run. A second run with unchanged data reports everything as
// unchanged, and a run interrupted partway can simply be started again.

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { getEnv, getWAAccountId, getWAToken } from "./wa-utils.js";
import { fetchAllWAContacts } from "./wa-contacts.js";
import { orgToday, planJoinBackfill, writeJoinBackfill, type RpcClient } from "./member-joins.js";

async function main() {
  const apply = process.argv.includes("--apply");
  const log = (m: string) => console.log(`backfillMemberJoins: ${m}`);

  const supabase = createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const contacts = await fetchAllWAContacts(await getWAToken(), getWAAccountId(), log);
  const plan = planJoinBackfill(contacts, orgToday());

  log(`${plan.contacts} contacts, ${plan.rows.length} with a start date`);
  log(
    `skipped: ${plan.skipped.notMember} not members, ${plan.skipped.noStartDate} no "Member since", ` +
      `${plan.skipped.outOfRange} out-of-range dates, ${plan.skipped.archived} archived`
  );
  for (const [year, n] of Object.entries(plan.byYear).sort()) {
    log(`  ${year}: ${n}`);
  }

  if (plan.rows.length === 0) {
    // Zero dates almost always means the field was not found, not that no one
    // has one. Stop rather than report success.
    throw new Error('No contact had a "Member since" date. Check the field in Wild Apricot.');
  }

  const result = await writeJoinBackfill(supabase as unknown as RpcClient, plan.rows, { apply });
  const verb = apply ? "" : "would be ";
  log(
    `${result.inserted} ${verb}inserted, ${result.updated} ${verb}updated, ` +
      `${result.unchanged} unchanged, ${result.missingMember} not in members (run sync-members first)`
  );
  if (!apply) log("dry run: nothing written. Re-run with --apply to write.");
}

main().catch((err) => {
  console.error("backfillMemberJoins failed:", err);
  process.exit(1);
});
