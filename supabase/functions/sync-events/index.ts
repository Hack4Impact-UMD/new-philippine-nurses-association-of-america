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

async function syncOneEvent(
  supabase: ReturnType<typeof getServiceClient>,
  accessToken: string,
  accountId: string,
  evId: string,
): Promise<void> {
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
  if (error) {
    // Best-effort: clear sync lock if the RPC failed mid-flight.
    await supabase.from("events").update({ syncLock: null }).eq("id", evId);
    throw error;
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  if (!verifyWebhookSecret(req)) {
    return new Response("Unauthorized", { status: 401 });
  }

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
      const { error } = await supabase.from("events").insert(newRows);
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
        } else {
          processed++;
        }
      }
    }
    console.log(
      `sync-events: synced registrations for ${processed} events (skipped ${skipped})`,
    );

    await supabase.from("sync_logs").insert({ type: "events", status: "complete" });

    return new Response(
      JSON.stringify({ events: rawEvents.length, newEvents: newRows.length }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("sync-events failed:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
