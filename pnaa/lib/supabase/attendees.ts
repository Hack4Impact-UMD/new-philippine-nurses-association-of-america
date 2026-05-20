// Attendees helpers — every write goes through a single Postgres RPC so the
// attendee row update and the event-counter update happen in one transaction.
// Replaces the previous read-modify-write trio of round-trips per admin click.

import type { Attendee } from "@/types/attendee";
import type { Member } from "@/types/member";
import type { EventType } from "@/types/event";
import { getSupabaseBrowser } from "./client";
import { hydrateTimestamps, Timestamp } from "./timestamp";

export const manualAttendeeId = (memberId: string) => `app-${memberId}`;

export async function setAttendance(params: {
  eventId: string;
  attendee: Attendee & { id: string };
  attended: boolean;
  // eventType / eventDefaultHours are kept in the signature so existing
  // callers don't break — the RPC reads the canonical values from the events
  // table itself, but a no-op early return saves a round-trip.
  eventType: EventType;
  eventDefaultHours: number;
  user: string;
}): Promise<void> {
  const { eventId, attendee, attended, user } = params;
  if (attendee.attended === attended) return;

  const supabase = getSupabaseBrowser();
  const { error } = await supabase.rpc("set_attendance", {
    p_event_id: eventId,
    p_attendee_id: attendee.id,
    p_attended: attended,
    p_user: user,
  });
  if (error) throw error;
}

export async function setAttendeeHours(params: {
  eventId: string;
  attendee: Attendee & { id: string };
  newHours: number;
  user: string;
}): Promise<void> {
  const { eventId, attendee, newHours, user } = params;
  if (Number(attendee.hours ?? 0) === newHours) return;

  const supabase = getSupabaseBrowser();
  const { error } = await supabase.rpc("set_attendee_hours", {
    p_event_id: eventId,
    p_attendee_id: attendee.id,
    p_hours: newHours,
    p_user: user,
  });
  if (error) throw error;
}

export async function addManualAttendee(params: {
  eventId: string;
  member: Member & { id: string };
  hours: number;
  user: string;
}): Promise<void> {
  const { eventId, member, hours, user } = params;
  const supabase = getSupabaseBrowser();
  const { error } = await supabase.rpc("add_manual_attendee", {
    p_event_id: eventId,
    p_member_id: member.id,
    p_name: member.name,
    p_hours: hours,
    p_user: user,
  });
  if (error) {
    // Postgres "X is already on this event's attendee list" comes back as a
    // RAISE EXCEPTION. Surface it cleanly.
    throw new Error(error.message);
  }
}

export async function removeManualAttendee(params: {
  eventId: string;
  attendee: Attendee & { id: string };
  user: string;
}): Promise<void> {
  const { eventId, attendee, user } = params;
  if (attendee.source !== "app") {
    throw new Error("Cannot remove WA-synced attendees");
  }

  const supabase = getSupabaseBrowser();
  const { error } = await supabase.rpc("remove_manual_attendee", {
    p_event_id: eventId,
    p_attendee_id: attendee.id,
    p_user: user,
  });
  if (error) throw new Error(error.message);
}

export async function propagateConferenceDefaultHours(params: {
  eventId: string;
  newDefaultHours: number;
  user: string;
}): Promise<void> {
  const { eventId, newDefaultHours, user } = params;
  const supabase = getSupabaseBrowser();
  const { error } = await supabase.rpc("propagate_conference_default_hours", {
    p_event_id: eventId,
    p_new_default: newDefaultHours,
    p_user: user,
  });
  if (error) throw error;
}

export async function fetchAttendees(
  eventId: string
): Promise<(Attendee & { id: string })[]> {
  const supabase = getSupabaseBrowser();
  const { data, error } = await supabase.from("attendees").select("*").eq("eventId", eventId);
  if (error) throw error;
  return (data ?? []).map(
    (r: Record<string, unknown>) => hydrateTimestamps(r) as unknown as Attendee & { id: string }
  );
}

/**
 * Paginated full fetch — used by bulk-upload matching, which needs every
 * attendee on the event regardless of PostgREST's 1000-row cap.
 */
export async function fetchAllAttendees(
  eventId: string
): Promise<(Attendee & { id: string })[]> {
  const supabase = getSupabaseBrowser();
  const PAGE = 1000;
  const out: (Attendee & { id: string })[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("attendees")
      .select("*")
      .eq("eventId", eventId)
      .order("name")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as Record<string, unknown>[];
    for (const r of rows) {
      out.push(hydrateTimestamps(r) as unknown as Attendee & { id: string });
    }
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

// ---------- Sub-event RPC wrappers ----------

export async function setSubeventAttendance(params: {
  eventId: string;
  attendeeId: string;
  subeventId: string;
  attended: boolean;
  user: string;
}): Promise<void> {
  const { eventId, attendeeId, subeventId, attended, user } = params;
  const supabase = getSupabaseBrowser();
  const { error } = await supabase.rpc("set_subevent_attendance", {
    p_event_id: eventId,
    p_attendee_id: attendeeId,
    p_subevent_id: subeventId,
    p_attended: attended,
    p_user: user,
  });
  if (error) throw new Error(error.message);
}

export async function addSubeventToEvent(params: {
  eventId: string;
  name: string;
  user: string;
}): Promise<string> {
  const supabase = getSupabaseBrowser();
  const { data, error } = await supabase.rpc("add_subevent_to_event", {
    p_event_id: params.eventId,
    p_subevent_name: params.name,
    p_user: params.user,
  });
  if (error) throw new Error(error.message);
  return String(data);
}

export async function removeSubeventFromEvent(params: {
  eventId: string;
  subeventId: string;
  user: string;
}): Promise<void> {
  const supabase = getSupabaseBrowser();
  const { error } = await supabase.rpc("remove_subevent_from_event", {
    p_event_id: params.eventId,
    p_subevent_id: params.subeventId,
    p_user: params.user,
  });
  if (error) throw new Error(error.message);
}

export async function reorderEventSubevents(params: {
  eventId: string;
  subeventIds: string[];
  user: string;
}): Promise<void> {
  const supabase = getSupabaseBrowser();
  const { error } = await supabase.rpc("reorder_event_subevents", {
    p_event_id: params.eventId,
    p_subevent_ids: params.subeventIds,
    p_user: params.user,
  });
  if (error) throw new Error(error.message);
}

export interface BulkSubeventRow {
  attendeeId: string;
  subeventId: string;
  attended: boolean;
}

export async function bulkSetSubeventAttendance(params: {
  eventId: string;
  rows: BulkSubeventRow[];
  user: string;
}): Promise<void> {
  const supabase = getSupabaseBrowser();
  const { error } = await supabase.rpc("bulk_set_subevent_attendance", {
    p_event_id: params.eventId,
    p_rows: params.rows,
    p_user: params.user,
  });
  if (error) throw new Error(error.message);
}

export async function fetchEvent<T>(eventId: string): Promise<(T & { id: string }) | null> {
  const supabase = getSupabaseBrowser();
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("id", eventId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return hydrateTimestamps(data) as T & { id: string };
}

export { Timestamp };
