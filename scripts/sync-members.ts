// Full member sync from Wild Apricot → Supabase.
// Replaces functions/src/sync-members.ts. Lives outside Edge Functions because
// the WA async-contacts job can take 5-8 minutes for 14k contacts, which
// exceeds Supabase Edge Functions' 400s wall time.
//
// Run locally:    npm run sync-members
// Run scheduled:  via .github/workflows/sync-members.yml

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import {
  getWAToken,
  getWAAccountId,
  mapContactToMember,
  ChapterResolver,
  getEnv,
  type MemberData,
  type ChapterRow,
  type ChapterAliasRow,
} from "./wa-utils.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchAllWAContacts(
  accessToken: string,
  accountId: string
): Promise<Record<string, unknown>[]> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };

  const initUrl = `https://api.wildapricot.org/v2/accounts/${accountId}/contacts?$filter=Archived%20eq%20false`;
  const initResponse = await fetch(initUrl, { headers });
  if (!initResponse.ok) {
    throw new Error(`WA contacts request failed: ${initResponse.statusText}`);
  }
  let data = (await initResponse.json()) as Record<string, unknown>;

  const resultUrl = data.ResultUrl as string | undefined;
  if (resultUrl && data.State !== "Complete") {
    console.log("syncMembers: waiting for WA contacts job...");
    for (let attempt = 0; attempt < 96; attempt++) {
      await sleep(5000);
      const r = await fetch(resultUrl, { headers });
      if (!r.ok) throw new Error(`WA contacts poll failed: ${r.statusText}`);
      data = (await r.json()) as Record<string, unknown>;
      if (data.State === "Complete") break;
    }
    if (data.State !== "Complete") {
      throw new Error(`WA contacts async job timed out (last state: ${data.State})`);
    }
  }

  const totalCount = (data.ResultCount as number) || 0;
  console.log(`syncMembers: ${totalCount} total contacts`);

  const PAGE_SIZE = 100;
  const allContacts: Record<string, unknown>[] = [];
  let skip = 0;
  const baseUrl = resultUrl || initUrl;

  while (true) {
    const sep = baseUrl.includes("?") ? "&" : "?";
    const pageUrl = `${baseUrl}${sep}$top=${PAGE_SIZE}&$skip=${skip}`;
    const r = await fetch(pageUrl, { headers });
    if (!r.ok) {
      console.error(`WA contacts page failed at skip=${skip}: ${r.statusText}`);
      break;
    }
    console.log(`syncMembers: fetched contacts page at skip=${skip}`);
    const pageData = (await r.json()) as Record<string, unknown>;
    const contacts = (pageData.Contacts as Record<string, unknown>[]) || [];
    if (contacts.length === 0) break;
    allContacts.push(...contacts);
    skip += contacts.length;
    if (contacts.length < PAGE_SIZE) break;
  }

  return allContacts;
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
    const isActive = m.renewalDueDate && new Date(m.renewalDueDate) >= now;
    if (isActive) chapterCounts[m.chapterId].totalActive++;
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
