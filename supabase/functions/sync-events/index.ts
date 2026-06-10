// Full event + attendee sync from Wild Apricot.
// HTTP-triggered: POST /functions/v1/sync-events?key=<WEBHOOK_SECRET>
//
// Insert-only for new events (never overwrites app-managed fields).
// For every event, diffs WA registrations against the attendees table.
// Uses a per-event syncLock to coordinate with the webhook handler.

import { getServiceClient, verifyWebhookSecret } from "../_shared/supabase.ts";
import {
  getWAToken,
  getWAAccountId,
  fetchWAEventRegistrations,
} from "../_shared/wa.ts";

type EventRow = {
  id: string;
  name?: string;
  startDate?: string;
  endDate?: string;
  location?: string;
  chapterId?: string;
  archived?: boolean;
};

// WA's /v2/events payload has no clean per-event chapter field, so we pin
// imports to the National chapter (region "National"). Admins can reassign
// from the app afterwards.
const DEFAULT_IMPORT_CHAPTER_ID = "national";

async function fetchAllWAEvents(
  accessToken: string,
  accountId: string,
): Promise<Record<string, unknown>[]> {
  const PAGE = 100;
  let skip = 0;
  const out: Record<string, unknown>[] = [];
  while (true) {
    const url =
      `https://api.wildapricot.org/v2/accounts/${accountId}/events?$top=${PAGE}&$skip=${skip}`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!r.ok) throw new Error(`WA events fetch failed: ${r.statusText}`);
    const data = await r.json();
    const page: Record<string, unknown>[] = (data.Events as Record<string, unknown>[]) ?? [];
    out.push(...page);
    skip += page.length;
    if (page.length < PAGE) break;
  }
  return out;
}

function eventToRow(ev: Record<string, unknown>): EventRow {
  return {
    id: String(ev.Id ?? ""),
    name: String(ev.Name ?? ""),
    startDate: ev.StartDate ? String(ev.StartDate) : undefined,
    endDate: ev.EndDate ? String(ev.EndDate) : undefined,
    location: String(ev.Location ?? ""),
    chapterId: DEFAULT_IMPORT_CHAPTER_ID,
    archived: false,
  };
}

type MissingMember = { contactId: string; name: string };

type SyncOutcome = {
  eventId: string;
  ok: boolean;
  reason?: string;
  // Registration contacts that aren't in the members table — the usual cause
  // of a failed event sync (attendees.memberId FK violation).
  missingMembers: MissingMember[];
};

// Which of these contact ids are NOT present in public.members? Chunked so a
// large conference (thousands of registrants) can't blow the PostgREST URL.
async function findMissingMembers(
  supabase: ReturnType<typeof getServiceClient>,
  contactIds: string[],
): Promise<Set<string>> {
  const missing = new Set(contactIds);
  const CHUNK = 200;
  for (let i = 0; i < contactIds.length; i += CHUNK) {
    const slice = contactIds.slice(i, i + CHUNK);
    const { data } = await supabase.from("members").select("id").in("id", slice);
    for (const m of data ?? []) missing.delete((m as { id: string }).id);
  }
  return missing;
}

async function syncOneEvent(
  supabase: ReturnType<typeof getServiceClient>,
  accessToken: string,
  accountId: string,
  evId: string,
): Promise<SyncOutcome> {
  // Fetch WA registrations (paginated; this is the one network call we can't
  // collapse into Postgres).
  const regs = await fetchWAEventRegistrations(accessToken, accountId, evId);

  // Single RPC call replaces 6 round-trips (lock → select existing → upsert
  // → delete orphans → counters → unlock). attended/hours on existing
  // attendee rows are preserved by the RPC's "on conflict do update set …"
  // which intentionally omits those columns.
  const { error } = await supabase.rpc("sync_event_registrations", {
    p_event_id: evId,
    p_registrations: regs,
  });
  if (!error) return { eventId: evId, ok: true, missingMembers: [] };

  // Don't touch syncLock here. The RPC sets and clears its own lock inside its
  // transaction, so a failure rolls back this run's lock write entirely — and
  // if the failure was lock contention, the lock belongs to another in-flight
  // worker that we must not clear out from under it.

  // Diagnose: surface the registration contacts that aren't in members so they
  // can be investigated. (Other failures — e.g. lock contention — leave this
  // list empty and just report the reason.)
  const contactIds = [...new Set(regs.map((r) => r.contactId).filter(Boolean))];
  const missingIds = contactIds.length > 0
    ? await findMissingMembers(supabase, contactIds)
    : new Set<string>();
  const seen = new Set<string>();
  const missingMembers: MissingMember[] = [];
  for (const r of regs) {
    if (r.contactId && missingIds.has(r.contactId) && !seen.has(r.contactId)) {
      seen.add(r.contactId);
      missingMembers.push({ contactId: r.contactId, name: r.name });
    }
  }

  return { eventId: evId, ok: false, reason: String(error.message ?? error), missingMembers };
}

async function runSync(): Promise<void> {
  try {
    const supabase = getServiceClient();
    const accessToken = await getWAToken();
    const accountId = getWAAccountId();

    const rawEvents = await fetchAllWAEvents(accessToken, accountId);
    console.log(`sync-events: fetched ${rawEvents.length} events from WA`);

    // Insert any new events; never overwrite existing rows (they may have
    // app-managed fields like eventType / defaultHours).
    const newRows: EventRow[] = [];
    const { data: existing } = await supabase.from("events").select("id");
    const existingIds = new Set((existing ?? []).map((e) => (e as { id: string }).id));
    for (const ev of rawEvents) {
      const row = eventToRow(ev);
      if (!existingIds.has(row.id)) newRows.push(row);
    }
    if (newRows.length > 0) {
      // Upsert-ignore rather than plain insert: another worker may insert one of
      // these ids between our select above and this write (TOCTOU). ON CONFLICT
      // DO NOTHING skips the duplicate instead of aborting the whole sync, and
      // never overwrites an existing row's app-managed fields.
      const { error } = await supabase
        .from("events")
        .upsert(newRows, { onConflict: "id", ignoreDuplicates: true });
      if (error) throw error;
    }
    console.log(`sync-events: inserted ${newRows.length} new events`);

    // Sync registrations for every event, chunked 3 at a time.
    // (#19) Catch per-event so one locked or transiently-failing event
    // doesn't abort the whole batch — the syncLock RPC now raises when
    // another in-flight run holds the lock.
    const allIds = rawEvents.map((ev) => String(ev.Id));
    let processed = 0;
    let skipped = 0;
    // contactId → { name, eventIds } across every skipped event.
    const missingMembers = new Map<string, { name: string; eventIds: string[] }>();
    for (let i = 0; i < allIds.length; i += 3) {
      const batch = allIds.slice(i, i + 3);
      const results = await Promise.allSettled(
        batch.map((id) => syncOneEvent(supabase, accessToken, accountId, id)),
      );
      for (let j = 0; j < results.length; j++) {
        const r = results[j];
        if (r.status === "rejected") {
          skipped++;
          console.warn(`sync-events: skipped event ${batch[j]}: ${r.reason}`);
        } else if (!r.value.ok) {
          skipped++;
          const o = r.value;
          console.warn(`sync-events: skipped event ${o.eventId}: ${o.reason}`);
          if (o.missingMembers.length > 0) {
            for (const m of o.missingMembers) {
              const hit = missingMembers.get(m.contactId);
              if (hit) hit.eventIds.push(o.eventId);
              else missingMembers.set(m.contactId, { name: m.name, eventIds: [o.eventId] });
            }
            console.warn(
              `sync-events: event ${o.eventId} references ${o.missingMembers.length} unknown member id(s): ` +
                o.missingMembers.map((m) => m.contactId).join(", "),
            );
          }
        } else {
          processed++;
        }
      }
    }
    console.log(
      `sync-events: synced registrations for ${processed} events (skipped ${skipped})`,
    );

    const missingMemberIds = [...missingMembers.entries()].map(
      ([contactId, { name, eventIds }]) => ({ contactId, name, eventIds }),
    );
    if (missingMemberIds.length > 0) {
      console.warn(
        `sync-events: ${missingMemberIds.length} unique member id(s) not found in members: ` +
          missingMemberIds.map((m) => m.contactId).join(", "),
      );
    }

    await supabase.from("sync_logs").insert({
      type: "events",
      status: "complete",
      error: missingMemberIds.length > 0
        ? `${missingMemberIds.length} unknown member id(s) across ${skipped} skipped event(s): ` +
          missingMemberIds.map((m) => m.contactId).join(", ")
        : null,
    });
  } catch (err) {
    console.error("sync-events failed:", err);
    try {
      await getServiceClient().from("sync_logs").insert({
        type: "events",
        status: "failed",
        error: String((err as Error)?.message ?? err),
      });
    } catch { /* best effort */ }
  }
}

Deno.serve((req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  if (!verifyWebhookSecret(req)) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Ack immediately and run the sync in the background. Callers (the admin
  // "trigger sync" route) would otherwise hold a connection open for minutes —
  // results land in the function logs and the sync_logs table. runSync never
  // rejects (it catches internally), so a floating promise is safe locally.
  const work = runSync();
  (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } })
    .EdgeRuntime?.waitUntil?.(work);

  return new Response(JSON.stringify({ accepted: true }), {
    status: 202,
    headers: { "Content-Type": "application/json" },
  });
});
