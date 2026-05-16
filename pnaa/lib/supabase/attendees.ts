// Attendees helpers — replaces lib/firebase/attendees.ts.
// All event-level counter writes use the same batch helper so the surface
// stays consistent with the Firestore-flavored code in event-form / attendee-list.

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
  eventType: EventType;
  eventDefaultHours: number;
  user: string;
}): Promise<void> {
  const { eventId, attendee, attended, eventType, eventDefaultHours, user } = params;
  if (attendee.attended === attended) return;

  const oldHours = Number(attendee.hours ?? 0);
  let newHours: number;
  if (!attended) {
    newHours = 0;
  } else if (eventType === "conference") {
    newHours = eventDefaultHours;
  } else {
    newHours = oldHours > 0 ? oldHours : eventDefaultHours;
  }

  const attendedDelta = (attended ? 1 : 0) - (attendee.attended ? 1 : 0);
  const hoursDelta = newHours - oldHours;

  const supabase = getSupabaseBrowser();

  // Update the attendee row.
  const { error: attErr } = await supabase
    .from("attendees")
    .update({ attended, hours: newHours })
    .eq("id", attendee.id);
  if (attErr) throw attErr;

  // Read-modify-write event counters.
  const { data: evRow, error: evErr } = await supabase
    .from("events")
    .select("attendedCount, contactHours")
    .eq("id", eventId)
    .single();
  if (evErr) throw evErr;
  const ev = evRow as { attendedCount: number; contactHours: number };
  const { error: updErr } = await supabase
    .from("events")
    .update({
      attendedCount: Number(ev.attendedCount ?? 0) + attendedDelta,
      contactHours: Number(ev.contactHours ?? 0) + hoursDelta,
      lastUpdatedUser: user,
    })
    .eq("id", eventId);
  if (updErr) throw updErr;
}

export async function setAttendeeHours(params: {
  eventId: string;
  attendee: Attendee & { id: string };
  newHours: number;
  user: string;
}): Promise<void> {
  const { eventId, attendee, newHours, user } = params;
  const oldHours = Number(attendee.hours ?? 0);
  const hoursDelta = newHours - oldHours;
  if (hoursDelta === 0) return;

  const supabase = getSupabaseBrowser();

  const { error: attErr } = await supabase
    .from("attendees")
    .update({ hours: newHours })
    .eq("id", attendee.id);
  if (attErr) throw attErr;

  const { data: evRow, error: evErr } = await supabase
    .from("events")
    .select("contactHours")
    .eq("id", eventId)
    .single();
  if (evErr) throw evErr;
  const { error: updErr } = await supabase
    .from("events")
    .update({
      contactHours: Number((evRow as { contactHours: number }).contactHours ?? 0) + hoursDelta,
      lastUpdatedUser: user,
    })
    .eq("id", eventId);
  if (updErr) throw updErr;
}

export async function addManualAttendee(params: {
  eventId: string;
  member: Member & { id: string };
  hours: number;
  user: string;
}): Promise<void> {
  const { eventId, member, hours, user } = params;
  const supabase = getSupabaseBrowser();

  // Dedupe: reject if the member is already an attendee on this event.
  const { data: dup } = await supabase
    .from("attendees")
    .select("id")
    .eq("eventId", eventId)
    .eq("memberId", member.id)
    .limit(1);
  if (dup && dup.length > 0) {
    throw new Error(`${member.name} is already on this event's attendee list`);
  }

  const id = manualAttendeeId(member.id);
  const newAttendee: Attendee = {
    registrationId: id,
    eventId,
    contactId: member.id,
    name: member.name,
    attended: true,
    hours,
    source: "app",
    memberId: member.id,
    registrationTypeId: "",
    registrationType: "",
    organization: "",
    isPaid: false,
    registrationFee: 0,
    paidSum: 0,
    OnWaitlist: false,
    Status: "",
  };

  const { error: insErr } = await supabase
    .from("attendees")
    .insert({ id, ...newAttendee });
  if (insErr) throw insErr;

  const { data: evRow, error: evErr } = await supabase
    .from("events")
    .select("attendees, attendedCount, contactHours")
    .eq("id", eventId)
    .single();
  if (evErr) throw evErr;
  const ev = evRow as { attendees: number; attendedCount: number; contactHours: number };
  const { error: updErr } = await supabase
    .from("events")
    .update({
      attendees: Number(ev.attendees ?? 0) + 1,
      attendedCount: Number(ev.attendedCount ?? 0) + 1,
      contactHours: Number(ev.contactHours ?? 0) + hours,
      lastUpdatedUser: user,
    })
    .eq("id", eventId);
  if (updErr) throw updErr;
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
  const wasAttended = attendee.attended;
  const oldHours = Number(attendee.hours ?? 0);

  const supabase = getSupabaseBrowser();
  const { error: delErr } = await supabase.from("attendees").delete().eq("id", attendee.id);
  if (delErr) throw delErr;

  const { data: evRow, error: evErr } = await supabase
    .from("events")
    .select("attendees, attendedCount, contactHours")
    .eq("id", eventId)
    .single();
  if (evErr) throw evErr;
  const ev = evRow as { attendees: number; attendedCount: number; contactHours: number };
  const { error: updErr } = await supabase
    .from("events")
    .update({
      attendees: Number(ev.attendees ?? 0) - 1,
      attendedCount: Math.max(0, Number(ev.attendedCount ?? 0) - (wasAttended ? 1 : 0)),
      contactHours: Number(ev.contactHours ?? 0) - (wasAttended ? oldHours : 0),
      lastUpdatedUser: user,
    })
    .eq("id", eventId);
  if (updErr) throw updErr;
}

export async function propagateConferenceDefaultHours(params: {
  eventId: string;
  newDefaultHours: number;
  user: string;
}): Promise<void> {
  const { eventId, newDefaultHours, user } = params;
  const supabase = getSupabaseBrowser();

  const { data: attended, error: selErr } = await supabase
    .from("attendees")
    .select("id")
    .eq("eventId", eventId)
    .eq("attended", true);
  if (selErr) throw selErr;
  const ids = (attended ?? []).map((r: { id: string }) => r.id);

  if (ids.length > 0) {
    const { error: updAttErr } = await supabase
      .from("attendees")
      .update({ hours: newDefaultHours })
      .in("id", ids);
    if (updAttErr) throw updAttErr;
  }

  const { error: evErr } = await supabase
    .from("events")
    .update({
      contactHours: ids.length * newDefaultHours,
      lastUpdatedUser: user,
    })
    .eq("id", eventId);
  if (evErr) throw evErr;
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
