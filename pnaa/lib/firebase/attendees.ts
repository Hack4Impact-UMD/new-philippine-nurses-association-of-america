import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  writeBatch,
  increment,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { db } from "./config";
import type { Attendee } from "@/types/attendee";
import type { Member } from "@/types/member";
import type { EventType } from "@/types/event";

/**
 * Helpers for writing the events/{eventId}/attendees/{attendeeId} subcollection.
 *
 * All event-level counters (attendees, attendedCount, contactHours) are kept
 * consistent here via FieldValue.increment in the same batch as the attendee write.
 */

const attendeeRef = (eventId: string, attendeeId: string) =>
  doc(db, "events", eventId, "attendees", attendeeId);

const eventRef = (eventId: string) => doc(db, "events", eventId);

/** Doc ID used for manually-added attendees, derived from the member's ID so we can dedupe. */
export const manualAttendeeId = (memberId: string) => `app-${memberId}`;

/**
 * Toggle attendance on an existing attendee record (WA or app source).
 *
 * For conferences: hours are always event.defaultHours when attended, 0 otherwise.
 * For community outreach: hours snapshot defaultHours on the first toggle-on if
 * none have been set; subsequent toggle-on uses whatever hours were last entered.
 */
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
    // Community outreach: keep whatever was last entered, or fall back to defaultHours.
    newHours = oldHours > 0 ? oldHours : eventDefaultHours;
  }

  const attendedDelta = (attended ? 1 : 0) - (attendee.attended ? 1 : 0);
  const hoursDelta = newHours - oldHours;

  const batch = writeBatch(db);
  batch.update(attendeeRef(eventId, attendee.id), {
    attended,
    hours: newHours,
  });
  batch.update(eventRef(eventId), {
    ...(attendedDelta !== 0 && { attendedCount: increment(attendedDelta) }),
    ...(hoursDelta !== 0 && { contactHours: increment(hoursDelta) }),
    lastUpdated: serverTimestamp(),
    lastUpdatedUser: user,
  });
  await batch.commit();
}

/**
 * Update hours on an already-attended attendee (community outreach only).
 * Adjusts the event's contactHours by the delta.
 */
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

  const batch = writeBatch(db);
  batch.update(attendeeRef(eventId, attendee.id), { hours: newHours });
  batch.update(eventRef(eventId), {
    contactHours: increment(hoursDelta),
    lastUpdated: serverTimestamp(),
    lastUpdatedUser: user,
  });
  await batch.commit();
}

/**
 * Manually add an attended member to an event. Rejects if the member is already
 * an attendee (any source) on this event.
 */
export async function addManualAttendee(params: {
  eventId: string;
  member: Member & { id: string };
  hours: number;
  user: string;
}): Promise<void> {
  const { eventId, member, hours, user } = params;

  // Block double-adds: a WA registration with the same contactId, or an
  // existing app record for the same member.
  const dupSnap = await getDocs(
    query(
      collection(db, "events", eventId, "attendees"),
      where("memberId", "==", member.id)
    )
  );
  if (!dupSnap.empty) {
    throw new Error(
      `${member.name} is already on this event's attendee list`
    );
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

  const batch = writeBatch(db);
  batch.set(attendeeRef(eventId, id), newAttendee);
  batch.update(eventRef(eventId), {
    attendees: increment(1),
    attendedCount: increment(1),
    ...(hours !== 0 && { contactHours: increment(hours) }),
    lastUpdated: serverTimestamp(),
    lastUpdatedUser: user,
  });
  await batch.commit();
}

/**
 * Remove a manually-added attendee. Only valid for source: "app" records;
 * WA-synced attendees should never be deleted from the app since the next
 * sync would re-create them.
 */
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

  const batch = writeBatch(db);
  batch.delete(attendeeRef(eventId, attendee.id));
  batch.update(eventRef(eventId), {
    attendees: increment(-1),
    ...(wasAttended && { attendedCount: increment(-1) }),
    ...(wasAttended && oldHours !== 0 && { contactHours: increment(-oldHours) }),
    lastUpdated: serverTimestamp(),
    lastUpdatedUser: user,
  });
  await batch.commit();
}

/**
 * Live-propagate a conference's defaultHours change to every attended attendee
 * and recompute the event's contactHours total. No-op for community outreach,
 * since their hours are per-attendee.
 */
export async function propagateConferenceDefaultHours(params: {
  eventId: string;
  newDefaultHours: number;
  user: string;
}): Promise<void> {
  const { eventId, newDefaultHours, user } = params;
  const attendedSnap = await getDocs(
    query(
      collection(db, "events", eventId, "attendees"),
      where("attended", "==", true)
    )
  );

  let batch = writeBatch(db);
  let count = 0;
  for (const d of attendedSnap.docs) {
    batch.update(d.ref, { hours: newDefaultHours });
    count++;
    if (count >= 450) {
      await batch.commit();
      batch = writeBatch(db);
      count = 0;
    }
  }
  batch.update(eventRef(eventId), {
    contactHours: attendedSnap.size * newDefaultHours,
    lastUpdated: serverTimestamp(),
    lastUpdatedUser: user,
  });
  await batch.commit();
}

/** Lightweight read used by event metrics / member detail when we want fresh attendee rows. */
export async function fetchAttendees(eventId: string): Promise<(Attendee & { id: string })[]> {
  const snap = await getDocs(collection(db, "events", eventId, "attendees"));
  return snap.docs.map((d) => ({ ...(d.data() as Attendee), id: d.id }));
}

/** Single-doc fetch helper. Returns null when missing. */
export async function fetchEvent<T>(eventId: string): Promise<(T & { id: string }) | null> {
  const snap = await getDoc(eventRef(eventId));
  return snap.exists() ? ({ ...(snap.data() as T), id: snap.id }) : null;
}

// Re-export Timestamp for convenience in callers that build attendee objects.
export { Timestamp };
