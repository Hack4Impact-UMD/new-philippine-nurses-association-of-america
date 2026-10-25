// Full member sync from Wild Apricot → Supabase.
// Replaces functions/src/sync-members.ts. Contacts are read with synchronous
// pagination ($async=false&$top&$skip). Lives outside Edge Functions because 
// the contacts sync job would exceed their 400s wall time.
//
// Run locally:    npm run sync-members
// Run scheduled:  via .github/workflows/sync-members.yml

import "dotenv/config";
import { setTimeout as sleep } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import {
  getWAToken,
  getWAAccountId,
  mapContactToMember,
  isRenewalActive,
  ChapterResolver,
  getEnv,
  type MemberData,
  type ChapterRow,
  type ChapterAliasRow,
} from "./wa-utils.js";

// One sync is ~160 WA requests, so retry 429 / 5xx / network errors with
// backoff (1s, 2s, 4s, or Retry-After). The final attempt's response or error
// goes to the caller.
async function fetchWithRetry(url: string, init: RequestInit, retries = 3): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    let delay = 1000 * 2 ** (attempt - 1);
    try {
      const r = await fetch(url, init);
      if (r.status !== 429 && r.status < 500) return r;
      const retryAfter = Number(r.headers.get("Retry-After"));
      console.log(`syncMembers: WA ${r.status}, retry ${attempt}/${retries} in ${delay}ms`);
    } catch {
      console.log(`syncMembers: WA network error, retry ${attempt}/${retries} in ${delay}ms`);
    }
    await sleep(delay);
  }
  return fetch(url, init);
}

async function fetchAllWAContacts(
  accessToken: string,
  accountId: string
): Promise<Record<string, unknown>[]> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };

  const baseUrl = `https://api.wildapricot.org/v2/accounts/${accountId}/contacts?$async=false&$filter=Archived%20eq%20false`;

  // Expected total, checked after paging: a short page ends the loop, so a
  // page cut short mid-list would otherwise look like the last one.
  const countResponse = await fetchWithRetry(`${baseUrl}&$count=true`, { headers });
  if (!countResponse.ok) {
    throw new Error(`WA contacts count failed: ${countResponse.statusText}`);
  }
  const expectedCount = ((await countResponse.json()) as { Count?: number }).Count;
  if (typeof expectedCount !== "number") {
    throw new Error("WA contacts count response had no Count");
  }
  console.log(`syncMembers: ${expectedCount} total contacts`);

  const PAGE_SIZE = 100;
  const allContacts: Record<string, unknown>[] = [];
  let skip = 0;

  while (true) {
    const pageUrl = `${baseUrl}&$top=${PAGE_SIZE}&$skip=${skip}`;
    const r = await fetchWithRetry(pageUrl, { headers });
    if (!r.ok) {
      // Throw rather than break: a partial snapshot would zero out chapter
      // aggregates for chapters whose members didn't make it into this run,
      // and still log the sync as "complete". Let main()'s catch record a
      // failure and skip the destructive chapter upserts.
      throw new Error(`WA contacts page failed at skip=${skip}: ${r.statusText}`);
    }
    console.log(`syncMembers: fetched contacts page at skip=${skip}`);
    const pageData = (await r.json()) as Record<string, unknown>;
    const contacts = (pageData.Contacts as Record<string, unknown>[]) || [];
    if (contacts.length === 0) break;
    allContacts.push(...contacts);
    skip += contacts.length;
    if (contacts.length < PAGE_SIZE) break;
  }

  // Paging a live list can return a contact twice, and a repeated id in one
  // upsert chunk makes Postgres reject the chunk. Dedupe before the count
  // check so duplicates can't mask missing contacts.
  const uniqueContacts = [...new Map(allContacts.map((c) => [String(c.Id), c])).values()];
  if (uniqueContacts.length < allContacts.length) {
    console.log(`syncMembers: dropped ${allContacts.length - uniqueContacts.length} duplicate contacts`);
  }

  // Allow 1% drift for contacts added or archived during the run.
  const COUNT_TOLERANCE = Math.ceil(expectedCount * 0.01);
  if (Math.abs(uniqueContacts.length - expectedCount) > COUNT_TOLERANCE) {
    throw new Error(
      `WA contacts fetch incomplete: got ${uniqueContacts.length}, expected ${expectedCount} (±${COUNT_TOLERANCE})`
    );
  }

  return uniqueContacts;
}

const COMPARE_FIELDS: (keyof MemberData)[] = [
  "name",
  "email",
  "membershipLevel",
  "renewalDueDate",
  "chapterId",
  "highestEducation",
  "memberId",
  "contactId",
  "region",
  "activeStatus",
];

async function main() {
  const supabase = createClient(
    getEnv("SUPABASE_URL"),
    getEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const accessToken = await getWAToken();
  const accountId = getWAAccountId();

  // Snapshot chapters + aliases up-front so we can resolve names → ids.
  const [chaptersResult, aliasesResult] = await Promise.all([
    supabase.from("chapters").select("id, name, region"),
    supabase.from("chapter_aliases").select("aliasName, chapterId"),
  ]);
  if (chaptersResult.error) throw chaptersResult.error;
  if (aliasesResult.error) throw aliasesResult.error;
  const resolver = new ChapterResolver(
    (chaptersResult.data ?? []) as ChapterRow[],
    (aliasesResult.data ?? []) as ChapterAliasRow[]
  );

  const rawContacts = await fetchAllWAContacts(accessToken, accountId);
  const allMembers: MemberData[] = [];
  for (const c of rawContacts) {
    const m = mapContactToMember(c, resolver);
    if (m) allMembers.push(m);
  }

  // Persist any chapters the resolver invented for unknown names.
  const newChapters = resolver.pendingChapters();
  if (newChapters.length > 0) {
    console.log(`syncMembers: creating ${newChapters.length} new chapter(s)`);
    const { error } = await supabase
      .from("chapters")
      .upsert(
        newChapters.map((c) => ({
          id: c.id,
          name: c.name,
          region: c.region,
        })),
        { onConflict: "id" }
      );
    if (error) throw error;
  }

  // Read existing rows once so we only write the diff.
  console.log("syncMembers: reading existing members for diff...");
  const { data: existingRows, error: selErr } = await supabase
    .from("members")
    .select(
      "id, name, email, membershipLevel, renewalDueDate, chapterId, highestEducation, memberId, contactId, region, activeStatus"
    );
  if (selErr) throw selErr;
  const existingMap = new Map<string, Record<string, unknown>>();
  for (const row of existingRows ?? []) {
    existingMap.set((row as { id: string }).id, row as Record<string, unknown>);
  }

  // Stage upserts in chunks of 500 (PostgREST recommended)
  const toUpsert: MemberData[] = [];
  let skipped = 0;
  for (const m of allMembers) {
    const existing = existingMap.get(m.id);
    const changed =
      !existing ||
      COMPARE_FIELDS.some(
        (f) => String((existing as Record<string, unknown>)[f] ?? "") !== String(m[f] ?? "")
      );
    if (!changed) {
      skipped++;
      continue;
    }
    toUpsert.push(m);
  }

  console.log(`syncMembers: ${toUpsert.length} to write, ${skipped} unchanged`);

  const CHUNK = 500;
  for (let i = 0; i < toUpsert.length; i += CHUNK) {
    const slice = toUpsert.slice(i, i + CHUNK);
    const { error } = await supabase.from("members").upsert(slice, { onConflict: "id" });
    if (error) throw error;
  }

  // Aggregate chapters in-memory from the WA snapshot.
  const now = new Date();
  const chapterCounts: Record<
    string,
    { totalMembers: number; totalActive: number; totalLapsed: number }
  > = {};
  for (const m of allMembers) {
    if (!m.chapterId) continue;
    if (!chapterCounts[m.chapterId]) {
      chapterCounts[m.chapterId] = { totalMembers: 0, totalActive: 0, totalLapsed: 0 };
    }
    chapterCounts[m.chapterId].totalMembers++;
    if (isRenewalActive(m.renewalDueDate, now)) chapterCounts[m.chapterId].totalActive++;
    else chapterCounts[m.chapterId].totalLapsed++;
  }

  // Zero out chapters that lost all members.
  const { data: existingChapters } = await supabase.from("chapters").select("id, name, region");
  const upserts: Array<Record<string, unknown>> = [];
  for (const c of existingChapters ?? []) {
    const row = c as { id: string; name: string; region: string | null };
    if (!chapterCounts[row.id]) {
      // Include name/region so the upsert is INSERT-safe if name was previously null.
      upserts.push({
        id: row.id,
        name: row.name,
        region: row.region,
        totalMembers: 0,
        totalActive: 0,
        totalLapsed: 0,
      });
    }
  }
  for (const [chapterId, counts] of Object.entries(chapterCounts)) {
    // Pull canonical name/region from the resolver so the upsert can INSERT
    // safely if the chapter row doesn't exist yet (NOT NULL on chapters.name).
    const meta = resolver.get(chapterId);
    upserts.push({
      id: chapterId,
      name: meta?.name ?? chapterId,
      region: meta?.region ?? null,
      totalMembers: counts.totalMembers,
      totalActive: counts.totalActive,
      totalLapsed: counts.totalLapsed,
    });
  }
  if (upserts.length > 0) {
    const { error } = await supabase.from("chapters").upsert(upserts, { onConflict: "id" });
    if (error) throw error;
  }

  const msg =
    `syncMembers: ${toUpsert.length} written, ${skipped} unchanged ` +
    `(${allMembers.length} total), updated ${Object.keys(chapterCounts).length} chapters`;
  console.log(msg);

  await supabase.from("sync_logs").insert({ type: "members", status: "complete" });
}

main().catch(async (err) => {
  console.error("syncMembers failed:", err);
  try {
    const supabase = createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"));
    await supabase.from("sync_logs").insert({
      type: "members",
      status: "failed",
      error: String(err?.message ?? err),
    });
  } catch {}
  process.exit(1);
});
