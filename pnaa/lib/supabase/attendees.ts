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
