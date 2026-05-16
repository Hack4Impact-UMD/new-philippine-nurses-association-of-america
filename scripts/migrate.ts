// One-shot Firestore → Supabase migration.
//
// Design constraint: each Firestore collection is read EXACTLY ONCE.
// Attendees use a collection-group query so the entire subcollection across
// every event is fetched in a single call. Firebase Auth users are walked
// once via the paginated listUsers cursor.
//
// Run:
//   cd scripts
//   cp .env.example .env   # populate (see comment below)
//   npm install
//   npm run migrate:dry-run    # read everything, log counts, no writes
//   npm run migrate            # do the write
//   npm run migrate -- --only=members,events
//
// Required env vars (put in scripts/.env):
//   FIREBASE_ADMIN_PROJECT_ID
//   FIREBASE_ADMIN_CLIENT_EMAIL
//   FIREBASE_ADMIN_PRIVATE_KEY   (with \n escape sequences, like in pnaa/.env.local)
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import "dotenv/config";
import admin from "firebase-admin";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ChapterResolver, type ChapterRow } from "./wa-utils.js";

// ---------- CLI flags ----------
const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const ONLY = (() => {
  const flag = process.argv.find((a) => a.startsWith("--only="));
  if (!flag) return null;
  return new Set(flag.slice("--only=".length).split(","));
})();
const LIMIT = (() => {
  const flag = process.argv.find((a) => a.startsWith("--limit="));
  if (!flag) return Infinity;
  return parseInt(flag.slice("--limit=".length), 10) || Infinity;
})();

const want = (name: string) => !ONLY || ONLY.has(name);

// ---------- Bootstrap ----------
function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env var: ${name}`);
    process.exit(1);
  }
  return v;
}

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: getEnv("FIREBASE_ADMIN_PROJECT_ID"),
    clientEmail: getEnv("FIREBASE_ADMIN_CLIENT_EMAIL"),
    privateKey: getEnv("FIREBASE_ADMIN_PRIVATE_KEY").replace(/\\n/g, "\n"),
  }),
});

const firestore = admin.firestore();
const firebaseAuth = admin.auth();
const supabase: SupabaseClient = createClient(
  getEnv("SUPABASE_URL"),
  getEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } }
);

// ---------- Helpers ----------

/** Convert Firestore Timestamps anywhere in a value to ISO strings. */
function normalize<T = unknown>(value: unknown): T {
  if (value == null) return value as T;
  if (value instanceof admin.firestore.Timestamp) {
    return value.toDate().toISOString() as unknown as T;
  }
  if (value instanceof Date) return value.toISOString() as unknown as T;
  if (Array.isArray(value)) return value.map((v) => normalize(v)) as unknown as T;
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = normalize(v);
    }
    return out as unknown as T;
  }
  return value as T;
}

/** Shorthand for the common "normalize a Firestore doc into a plain object" use. */
function row(data: unknown): Record<string, unknown> {
  return normalize<Record<string, unknown>>(data) ?? {};
}

/** Upsert in chunks. Throws on first failure. */
async function upsert(
  table: string,
  rows: Record<string, unknown>[],
  onConflict = "id",
  chunkSize = 500
): Promise<number> {
  if (DRY_RUN) {
    console.log(`  [dry-run] would upsert ${rows.length} rows into ${table}`);
    return rows.length;
  }
  let written = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const slice = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from(table).upsert(slice, { onConflict });
    if (error) throw new Error(`Failed upsert into ${table} chunk ${i}: ${error.message}`);
    written += slice.length;
  }
  return written;
}

function limited<T>(arr: T[]): T[] {
  return arr.length > LIMIT ? arr.slice(0, LIMIT) : arr;
}

// ---------- Migrations ----------

interface CollectionResult {
  read: number;
  written: number;
  skipped: number;
}

// Shared resolver — built by migrateChapters() and reused by every subsequent
// migration step that needs to translate Firestore's free-form chapter strings
// into chapter ids. Pre-seed with an empty instance so type-narrowing works
// without `?.` everywhere; migrateChapters() replaces it.
let resolver: ChapterResolver = new ChapterResolver([], []);

/** Walk Firebase Auth users in one paginated pass + collect Firestore /users docs. */
async function migrateUsers(): Promise<CollectionResult> {
  console.log("\n== users (auth.users + public.users) ==");

  // One pass over Firebase Auth users
  const firebaseUsers: admin.auth.UserRecord[] = [];
  let pageToken: string | undefined;
  do {
    const result = await firebaseAuth.listUsers(1000, pageToken);
    firebaseUsers.push(...result.users);
    pageToken = result.pageToken;
  } while (pageToken);
  console.log(`  Firebase Auth users: ${firebaseUsers.length}`);

  // One pass over Firestore /users
  const userDocs = await firestore.collection("users").get();
  const profileByUid = new Map<string, Record<string, unknown>>();
  for (const doc of userDocs.docs) {
    profileByUid.set(doc.id, row(doc.data()));
  }
  console.log(`  Firestore /users docs: ${userDocs.size}`);

  let created = 0;
  let skipped = 0;
  const profileRows: Record<string, unknown>[] = [];

  for (const fbUser of limited(firebaseUsers)) {
    const uid = fbUser.uid;
    const email = fbUser.email;
    const displayName = fbUser.displayName ?? "";
    if (!email) {
      console.warn(`  skip ${uid}: no email`);
      skipped++;
      continue;
    }
    const profile = profileByUid.get(uid) ?? {};
    const role = (profile.role as string) ?? "member";
    const chapterName = (profile.chapterName as string | undefined) ?? null;
    const region = (profile.region as string | undefined) ?? null;

    if (!DRY_RUN) {
      // Create auth.users with the same UID. If it already exists, ignore.
      // The SDK type doesn't list `id`, but the underlying GoTrue admin API
      // honors it — required so existing FKs (subchapters.createdBy etc.) resolve.
      const createPayload = {
        id: uid,
        email,
        email_confirm: true,
        user_metadata: { displayName },
        app_metadata: {
          user_role: role,
          ...(chapterName ? { chapter_name: chapterName } : {}),
          ...(region ? { region } : {}),
        },
      } as Parameters<typeof supabase.auth.admin.createUser>[0] & { id: string };
      const { error: createErr } = await supabase.auth.admin.createUser(createPayload);
      if (createErr && !/already.*registered|email.*exists|user.*exists/i.test(createErr.message)) {
        console.warn(`  failed createUser for ${email}: ${createErr.message}`);
        skipped++;
        continue;
      }
      if (!createErr) created++;
    } else {
      created++;
    }

    profileRows.push({
      id: uid,
      email,
      displayName,
      role,
      chapterName,
      region,
      waContactId: profile.waContactId ?? null,
      needsOnboarding: profile.needsOnboarding ?? false,
      createdAt: profile.createdAt ?? new Date().toISOString(),
      lastLogin: profile.lastLogin ?? new Date().toISOString(),
    });
  }

  // Upsert public.users (the auth.users insert trigger may have already
  // created a skeleton row — upsert overwrites it with the proper values).
  const written = await upsert("users", profileRows);

  console.log(`  → auth.users created: ${created}, profile rows upserted: ${written}, skipped: ${skipped}`);
  return { read: firebaseUsers.length, written, skipped };
}

async function migrateChapters(): Promise<CollectionResult> {
  console.log("\n== chapters ==");
  const snap = await firestore.collection("chapters").get();
  console.log(`  read: ${snap.size}`);
  const chapterRows: ChapterRow[] = [];
  const rows = limited(
    snap.docs.map((doc) => {
      const d = row(doc.data());
      const region = (d.region as string | undefined) ?? null;
      const name = (d.name as string) ?? "";
      chapterRows.push({ id: doc.id, name, region });
      return {
        id: doc.id,
        name,
        region,
        totalMembers: d.totalMembers ?? 0,
        totalActive: d.totalActive ?? 0,
        totalLapsed: d.totalLapsed ?? 0,
        lastUpdated: d.lastUpdated ?? new Date().toISOString(),
      };
    })
  );
  const written = await upsert("chapters", rows);
  console.log(`  → wrote ${written}`);

  // Seed the resolver — aliases get folded in by migrateChapterAliases().
  resolver = new ChapterResolver(chapterRows, []);

  return { read: snap.size, written, skipped: 0 };
}

async function migrateSubchapters(): Promise<CollectionResult> {
  console.log("\n== subchapters ==");
  const snap = await firestore.collection("subchapters").get();
  console.log(`  read: ${snap.size}`);
  let skipped = 0;
  const built: Record<string, unknown>[] = [];
  for (const doc of snap.docs) {
    const d = row(doc.data());
    let chapterId = (d.chapterId as string | undefined) ?? "";
    if (!chapterId && d.chapterName) {
      chapterId = resolver.resolve(String(d.chapterName)) ?? "";
    }
    if (!chapterId) {
      skipped++;
      continue;
    }
    built.push({
      id: doc.id,
      name: d.name ?? "",
      chapterId,
      description: d.description ?? null,
      memberIds: d.memberIds ?? [],
      archived: d.archived ?? false,
      createdBy: d.createdBy ?? null,
      lastUpdatedUser: d.lastUpdatedUser ?? null,
      createdAt: d.createdAt ?? new Date().toISOString(),
      lastUpdated: d.lastUpdated ?? new Date().toISOString(),
    });
  }
  const rows = limited(built);
  if (skipped) console.warn(`  dropped ${skipped} subchapters with no resolvable chapter`);
  const written = await upsert("subchapters", rows);
  console.log(`  → wrote ${written}`);
  return { read: snap.size, written, skipped };
}

async function migrateChapterAliases(): Promise<CollectionResult> {
  console.log("\n== chapter_aliases ==");
  const snap = await firestore.collection("chapter_aliases").get();
  console.log(`  read: ${snap.size}`);
  const aliasRows: { aliasName: string; chapterId: string }[] = [];
  const rows = limited(
    snap.docs.map((doc) => {
      const d = row(doc.data());
      const aliasName = (d.aliasName as string) ?? "";
      const chapterId = (d.chapterId as string) ?? "";
      if (aliasName && chapterId) aliasRows.push({ aliasName, chapterId });
      return {
        id: doc.id,
        chapterId,
        aliasName,
        createdBy: d.createdBy ?? "system",
        createdAt: d.createdAt ?? new Date().toISOString(),
        lastUpdated: d.lastUpdated ?? new Date().toISOString(),
      };
    })
  );
  const written = await upsert("chapter_aliases", rows);
  console.log(`  → wrote ${written}`);

  // Fold aliases into the resolver so subsequent migrations match alternative names.
  if (resolver) {
    for (const a of aliasRows) {
      resolver.resolve(a.aliasName);
    }
  }

  return { read: snap.size, written, skipped: 0 };
}

async function migrateMembers(): Promise<CollectionResult> {
  console.log("\n== members ==");
  const snap = await firestore.collection("members").get();
  console.log(`  read: ${snap.size}`);
  let unresolved = 0;
  const rows = limited(
    snap.docs.map((doc) => {
      const d = row(doc.data());
      const chapterName = (d.chapterName as string | undefined) ?? "";
      const chapterId = chapterName ? resolver.resolve(chapterName) ?? null : null;
      if (chapterName && !chapterId) unresolved++;
      return {
        id: doc.id,
        name: d.name ?? "",
        email: d.email ?? "",
        membershipLevel: d.membershipLevel ?? "",
        renewalDueDate: d.renewalDueDate ?? "",
        chapterId,
        highestEducation: d.highestEducation ?? "",
        memberId: d.memberId ?? doc.id,
        region: d.region ?? "",
        activeStatus: d.activeStatus ?? "Lapsed",
        lastSynced: d.lastSynced ?? new Date().toISOString(),
      };
    })
  );
  if (unresolved) console.warn(`  ${unresolved} member chapter names didn't resolve`);
  await flushPendingChapters();
  const written = await upsert("members", rows);
  console.log(`  → wrote ${written}`);
  return { read: snap.size, written, skipped: 0 };
}

/** If the resolver invented any new chapters, persist them before the next FK insert. */
async function flushPendingChapters(): Promise<void> {
  if (!resolver) return;
  const pending = resolver.pendingChapters();
  if (pending.length === 0) return;
  if (DRY_RUN) {
    console.log(`  [dry-run] would create ${pending.length} new chapter(s) for unknown names`);
    return;
  }
  const { error } = await supabase
    .from("chapters")
    .upsert(
      pending.map((c) => ({ id: c.id, name: c.name, region: c.region })),
      { onConflict: "id" }
    );
  if (error) throw new Error(`flushPendingChapters: ${error.message}`);
  console.log(`  flushed ${pending.length} new chapter(s) discovered during member migration`);
}

async function migrateEvents(): Promise<CollectionResult> {
  console.log("\n== events ==");
  const snap = await firestore.collection("events").get();
  console.log(`  read: ${snap.size}`);
  const rows = limited(
    snap.docs.map((doc) => {
      const d = row(doc.data());
      const chapterName = (d.chapter as string | undefined) ?? "";
      const chapterId = chapterName ? resolver.resolve(chapterName) ?? null : null;
      return {
        id: doc.id,
        name: d.name ?? "",
        startDate: d.startDate ?? null,
        endDate: d.endDate ?? null,
        location: d.location ?? "",
        chapterId,
        archived: d.archived ?? false,
        eventType: d.eventType ?? "conference",
        eventSubtype: d.eventSubtype ?? "in_person",
        defaultHours: d.defaultHours ?? 0,
        about: d.about ?? "",
        startTime: d.startTime ?? "",
        endTime: d.endTime ?? "",
        attendees: d.attendees ?? 0,
        registrations: d.registrations ?? 0,
        incompleteRegistrations: d.incompleteRegistrations ?? 0,
        totalRevenue: d.totalRevenue ?? 0,
        volunteers: d.volunteers ?? 0,
        participantsServed: d.participantsServed ?? 0,
        contactHours: d.contactHours ?? 0,
        attendedCount: d.attendedCount ?? 0,
        volunteerHours: d.volunteerHours ?? 0,
        subchapterId: d.subchapterId ?? null,
        source: d.source ?? "wildapricot",
        lastUpdatedUser: d.lastUpdatedUser ?? null,
        lastUpdated: d.lastUpdated ?? new Date().toISOString(),
        creationDate: d.creationDate ?? new Date().toISOString(),
      };
    })
  );
  await flushPendingChapters();
  const written = await upsert("events", rows);
  console.log(`  → wrote ${written}`);
  return { read: snap.size, written, skipped: 0 };
}

/** Single collectionGroup query pulls every attendee across every event. */
async function migrateAttendees(): Promise<CollectionResult> {
  console.log("\n== attendees ==");
  const snap = await firestore.collectionGroup("attendees").get();
  console.log(`  read: ${snap.size}`);

  const rows = limited(
    snap.docs.map((doc) => {
      const d = row(doc.data());
      // Firestore path: events/{eventId}/attendees/{attendeeId}
      const eventId = doc.ref.parent.parent?.id ?? "";
      return {
        id: doc.id,
        registrationId: d.registrationId ?? doc.id,
        eventId,
        contactId: d.contactId ?? null,
        memberId: d.memberId ?? d.contactId ?? null,
        name: d.name ?? "",
        attended: d.attended ?? false,
        hours: d.hours ?? 0,
        source: d.source ?? "wildapricot",
        registrationTypeId: d.registrationTypeId ?? null,
        registrationType: d.registrationType ?? null,
        organization: d.organization ?? null,
        isPaid: d.isPaid ?? null,
        registrationFee: d.registrationFee ?? null,
        paidSum: d.paidSum ?? null,
        OnWaitlist: d.OnWaitlist ?? null,
        Status: d.Status ?? null,
      };
    })
  );

  // Drop any attendees whose parent event isn't in the migration set —
  // the FK on attendees.eventId would otherwise fail.
  const filtered = rows.filter((r) => r.eventId);
  const dropped = rows.length - filtered.length;
  if (dropped) console.warn(`  dropped ${dropped} orphan attendee rows (no eventId)`);

  const written = await upsert("attendees", filtered);
  console.log(`  → wrote ${written}`);
  return { read: snap.size, written, skipped: dropped };
}

async function migrateFundraising(): Promise<CollectionResult> {
  console.log("\n== fundraising ==");
  const snap = await firestore.collection("fundraising").get();
  console.log(`  read: ${snap.size}`);
  const rows = limited(
    snap.docs.map((doc) => {
      const d = row(doc.data());
      const chapterName = (d.chapterName as string | undefined) ?? "";
      const chapterId = chapterName ? resolver.resolve(chapterName) ?? null : null;
      return {
        id: doc.id,
        fundraiserName: d.fundraiserName ?? "",
        chapterId,
        subchapterId: d.subchapterId ?? null,
        date: d.date ?? null,
        amount: d.amount ?? 0,
        note: d.note ?? null,
        archived: d.archived ?? false,
        lastUpdated: d.lastUpdated ?? new Date().toISOString(),
        lastUpdatedUser: d.lastUpdatedUser ?? null,
        creationDate: d.creationDate ?? new Date().toISOString(),
      };
    })
  );
  await flushPendingChapters();
  const written = await upsert("fundraising", rows);
  console.log(`  → wrote ${written}`);
  return { read: snap.size, written, skipped: 0 };
}

// ---------- Orchestrate ----------

async function main(): Promise<void> {
  console.log(
    `\nFirestore → Supabase migration  ${DRY_RUN ? "(DRY-RUN)" : ""}` +
      (ONLY ? `  only: ${[...ONLY].join(",")}` : "") +
      (LIMIT !== Infinity ? `  limit: ${LIMIT}` : "")
  );
  console.log("=".repeat(60));

  const totals: Record<string, CollectionResult> = {};

  // FK-safe order. Each step's reads are a single Firestore call.
  if (want("users")) totals.users = await migrateUsers();
  if (want("chapters")) totals.chapters = await migrateChapters();
  if (want("subchapters")) totals.subchapters = await migrateSubchapters();
  if (want("chapter_aliases")) totals.chapter_aliases = await migrateChapterAliases();
  if (want("members")) totals.members = await migrateMembers();
  if (want("events")) totals.events = await migrateEvents();
  if (want("attendees")) totals.attendees = await migrateAttendees();
  if (want("fundraising")) totals.fundraising = await migrateFundraising();

  console.log("\n" + "=".repeat(60));
  console.log("Summary");
  console.log("=".repeat(60));
  console.log("collection".padEnd(20) + "read".padStart(10) + "written".padStart(10) + "skipped".padStart(10));
  for (const [name, r] of Object.entries(totals)) {
    console.log(
      name.padEnd(20) +
        String(r.read).padStart(10) +
        String(r.written).padStart(10) +
        String(r.skipped).padStart(10)
    );
  }
  console.log("=".repeat(60));
  console.log(DRY_RUN ? "DRY-RUN complete — no writes performed." : "Migration complete.");
}

main().catch((err) => {
  console.error("\nMigration failed:", err);
  process.exit(1);
});
