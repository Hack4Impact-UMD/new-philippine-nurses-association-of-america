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
  archived?: boolean;
};

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
    archived: false,
  };
}

async function syncOneEvent(
  supabase: ReturnType<typeof getServiceClient>,
  accessToken: string,
  accountId: string,
  evId: string,
): Promise<void> {
  // Acquire per-event sync lock.
  const { error: lockErr } = await supabase
    .from("events")
    .update({ syncLock: new Date().toISOString() })
    .eq("id", evId);
  if (lockErr) throw lockErr;

  try {
    const regs = await fetchWAEventRegistrations(accessToken, accountId, evId);

    // Fetch existing attendee rows for this event.
    const { data: existingRows } = await supabase
      .from("attendees")
      .select("id, registrationId, source, attended, hours, contactId, memberId, name, registrationTypeId, registrationType, organization, isPaid, registrationFee, paidSum, OnWaitlist, Status")
      .eq("eventId", evId);

    const existingByRegId = new Map<string, Record<string, unknown>>();
    for (const row of existingRows ?? []) {
      existingByRegId.set((row as { registrationId: string }).registrationId, row as Record<string, unknown>);
    }

    const toUpsert: Record<string, unknown>[] = [];
    const seenIds = new Set<string>();
    for (const reg of regs) {
      const id = reg.registrationId;
      seenIds.add(id);
      const existing = existingByRegId.get(id);
      // Preserve attended/hours on existing rows.
      toUpsert.push({
        id,
        registrationId: id,
        eventId: evId,
        contactId: reg.contactId,
        memberId: reg.contactId,
        name: reg.name,
        attended: (existing?.attended as boolean) ?? false,
        hours: (existing?.hours as number) ?? 0,
        source: "wildapricot",
        registrationTypeId: reg.registrationTypeId,
        registrationType: reg.registrationType,
        organization: reg.organization,
        isPaid: reg.isPaid,
        registrationFee: reg.registrationFee,
        paidSum: reg.paidSum,
        OnWaitlist: reg.OnWaitlist,
        Status: reg.Status,
      });
    }

    if (toUpsert.length > 0) {
      const { error } = await supabase.from("attendees").upsert(toUpsert, { onConflict: "id" });
      if (error) throw error;
    }

    // Delete WA attendees no longer in the registration list (preserve manual rows).
    const orphans: string[] = [];
    for (const row of existingRows ?? []) {
      const r = row as { id: string; registrationId: string; source: string };
      if (r.source === "wildapricot" && !seenIds.has(r.registrationId)) {
        orphans.push(r.id);
      }
    }
    if (orphans.length > 0) {
      await supabase.from("attendees").delete().in("id", orphans);
    }

    // Recompute counters.
    const registrations = regs.length;
    const incompleteRegistrations = regs.filter((r) => !r.isPaid).length;
    const totalRevenue = regs.reduce((acc, r) => acc + Number(r.paidSum ?? 0), 0);
    const attendees = regs.length;

    await supabase
      .from("events")
      .update({
        registrations,
        attendees,
        incompleteRegistrations,
        totalRevenue,
      })
      .eq("id", evId);
  } finally {
    await supabase
      .from("events")
      .update({ syncLock: null })
      .eq("id", evId);
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
    const allIds = rawEvents.map((ev) => String(ev.Id));
    let processed = 0;
    for (let i = 0; i < allIds.length; i += 3) {
      const batch = allIds.slice(i, i + 3);
      await Promise.all(
        batch.map((id) => syncOneEvent(supabase, accessToken, accountId, id)),
      );
      processed += batch.length;
    }
    console.log(`sync-events: synced registrations for ${processed} events`);

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
