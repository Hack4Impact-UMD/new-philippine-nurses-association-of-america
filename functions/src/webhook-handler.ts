/**
 * Wild Apricot webhook receiver.
 *
 * Configure ONE webhook in WA (Apps > Integrations > Webhooks) with:
 *   URL:               https://[region]-[project].cloudfunctions.net/wildApricotWebhook?key=[WEBHOOK_SECRET]
 *   Authorization:     Secret token (query)
 *   Token name:        key
 *   Token value:       [WEBHOOK_SECRET value from functions/.env]
 *   Notification types: Contact, Membership, Event, MembershipRenewed
 *
 * MessageType routing:
 *   Contact / Membership / MembershipRenewed
 *     → fetch single contact from WA → upsert member → increment chapter aggregates
 *   Event (Created)
 *     → insert into Firestore if not already present (INSERT ONLY, same as syncEvents)
 *   Event (Changed)
 *     → update WA-owned fields only (name, dates, location); app-managed fields preserved
 *   Event (Deleted)
 *     → soft-delete (archived: true)
 */

import { onRequest } from "firebase-functions/v2/https";
import { defineString } from "firebase-functions/params";
import { getFirestore, Timestamp, FieldValue } from "firebase-admin/firestore";
import {
  getWAToken,
  getWAAccountId,
  fetchWAContact,
  fetchWAEvent,
  mapContactToMember,
  chapterSlug,
} from "./wa-utils";

const WEBHOOK_SECRET = defineString("WEBHOOK_SECRET");

interface WAWebhookBody {
  AccountId: number;
  MessageType: string;
  Parameters: Record<string, unknown>;
}

export const wildApricotWebhook = onRequest(async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  // Validate secret token sent by WA as a query param
  const key = req.query["key"] as string | undefined;
  if (!key || key !== WEBHOOK_SECRET.value()) {
    res.status(401).send("Unauthorized");
    return;
  }

  const body = req.body as WAWebhookBody;
  const { MessageType, Parameters } = body;

  try {
    switch (MessageType) {
      case "Contact":
        await handleContact(String(Parameters["Contact.Id"]));
        break;

      case "Membership":
      case "MembershipRenewed":
        await handleContact(String(Parameters["Contact.Id"]));
        break;

      case "Event": {
        const eventId = String(Parameters["Event.Id"]);
        const action = String(Parameters["Action"]) as "Created" | "Changed" | "Deleted";
        await handleEvent(eventId, action);
        break;
      }

      default:
        console.log(`wildApricotWebhook: unhandled MessageType "${MessageType}"`);
    }
  } catch (err) {
    // Always return 200 — returning non-200 would cause WA to retry indefinitely,
    // which could re-trigger the same transient error in a loop.
    console.error(`wildApricotWebhook: error processing ${MessageType}:`, err);
  }

  res.status(200).send("OK");
});

async function handleContact(waContactId: string): Promise<void> {
  const db = getFirestore();
  const token = await getWAToken();
  const accountId = getWAAccountId();

  const contact = await fetchWAContact(token, accountId, waContactId);
  if (!contact) {
    console.log(`wildApricotWebhook: contact ${waContactId} not found in WA`);
    return;
  }

  const member = mapContactToMember(contact);
  if (!member) {
    console.log(`wildApricotWebhook: contact ${waContactId} is archived, skipping`);
    return;
  }

  // Must run before the member doc write so stored chapterName matches syncMembers.
  if (!member.chapterName && member.membershipLevel === "Member-at-Large (1 year)") {
    member.chapterName = "PNA Member-at-Large";
  }

  const docRef = db.collection("members").doc(member.memberId);

  // Read old state before overwriting so we can compute the exact chapter delta
  const oldDoc = await docRef.get();
  const isNewMember = !oldDoc.exists;
  const oldChapterName = isNewMember ? "" : ((oldDoc.data()?.chapterName as string) || "");
  const oldActiveStatus = isNewMember
    ? null
    : ((oldDoc.data()?.activeStatus as "Active" | "Lapsed") || "Lapsed");

  await docRef.set(member, { merge: true });

  const newChapterName = member.chapterName || "";
  const newActiveStatus = member.activeStatus;
  // PNA Member-at-Large chapter has no region (matches syncMembers).
  const newChapterRegion = newChapterName === "PNA Member-at-Large" ? "" : member.region;
  const chapterBatch = db.batch();
  let chapterUpdates = 0;

  if (oldChapterName && oldChapterName !== newChapterName) {
    // Member left this chapter — decrement their contribution
    const oldChapterRef = db.collection("chapters").doc(chapterSlug(oldChapterName));
    chapterBatch.set(oldChapterRef, {
      totalMembers: FieldValue.increment(-1),
      ...(oldActiveStatus === "Active" && { totalActive: FieldValue.increment(-1) }),
      ...(oldActiveStatus === "Lapsed" && { totalLapsed: FieldValue.increment(-1) }),
      lastUpdated: Timestamp.now(),
    }, { merge: true });
    chapterUpdates++;
  }

  if (newChapterName) {
    const newChapterRef = db.collection("chapters").doc(chapterSlug(newChapterName));

    if (isNewMember || oldChapterName !== newChapterName) {
      // Member joined this chapter (new member or chapter transfer)
      chapterBatch.set(newChapterRef, {
        name: newChapterName,
        region: newChapterRegion,
        totalMembers: FieldValue.increment(1),
        ...(newActiveStatus === "Active" && { totalActive: FieldValue.increment(1) }),
        ...(newActiveStatus === "Lapsed" && { totalLapsed: FieldValue.increment(1) }),
        lastUpdated: Timestamp.now(),
      }, { merge: true });
      chapterUpdates++;
    } else if (oldActiveStatus !== newActiveStatus) {
      // Same chapter, status changed (e.g. admin-triggered renewal or lapse)
      const activeDelta = newActiveStatus === "Active" ? 1 : -1;
      chapterBatch.set(newChapterRef, {
        name: newChapterName,
        region: newChapterRegion,
        totalActive: FieldValue.increment(activeDelta),
        totalLapsed: FieldValue.increment(-activeDelta),
        lastUpdated: Timestamp.now(),
      }, { merge: true });
      chapterUpdates++;
    }
    // else: same chapter, same status — no chapter update needed
  }

  if (chapterUpdates > 0) await chapterBatch.commit();

  console.log(`wildApricotWebhook: updated member ${member.memberId} (${member.name})`);
}

async function handleEvent(
  eventId: string,
  action: "Created" | "Changed" | "Deleted"
): Promise<void> {
  const db = getFirestore();
  const docRef = db.collection("events").doc(eventId);

  if (action === "Deleted") {
    const existing = await docRef.get();
    if (existing.exists) {
      await docRef.update({
        archived: true,
        lastUpdated: Timestamp.now(),
        lastUpdatedUser: "WildApricot",
      });
      console.log(`wildApricotWebhook: soft-deleted event ${eventId}`);
    }
    return;
  }

  const token = await getWAToken();
  const accountId = getWAAccountId();

  const event = await fetchWAEvent(token, accountId, eventId);
  if (!event) {
    console.log(`wildApricotWebhook: event ${eventId} not found in WA`);
    return;
  }

  const startDate = event.StartDate ? String(event.StartDate).split("T")[0] : "";
  const endDate = event.EndDate ? String(event.EndDate).split("T")[0] : startDate;

  if (action === "Created") {
    const existing = await docRef.get();
    if (existing.exists) {
      console.log(`wildApricotWebhook: event ${eventId} already exists, skipping insert`);
      return;
    }

    await docRef.set({
      id: eventId,
      name: event.Name || "",
      startDate,
      endDate,
      location: event.Location || "",
      chapter: "",
      region: "National",
      archived: false,
      about: "",
      startTime: "",
      endTime: "",
      eventPoster: { name: "", ref: "", downloadURL: "" },
      attendees: 0,
      volunteers: 0,
      participantsServed: 0,
      contactHours: 0,
      volunteerHours: 0,
      source: "wildapricot",
      lastUpdatedUser: "WildApricot",
      lastUpdated: Timestamp.now(),
      creationDate: Timestamp.now(),
    });
    console.log(`wildApricotWebhook: inserted event ${eventId}`);
  } else {
    // Changed — update only WA-owned fields; preserve app-managed fields
    // (chapter, region, about, startTime, endTime, eventPoster, attendees, etc.)
    const existing = await docRef.get();
    if (!existing.exists) {
      console.log(`wildApricotWebhook: event ${eventId} not in Firestore, skipping update`);
      return;
    }

    await docRef.update({
      name: event.Name || "",
      startDate,
      endDate,
      location: event.Location || "",
      lastUpdated: Timestamp.now(),
      lastUpdatedUser: "WildApricot",
    });
    console.log(`wildApricotWebhook: updated event ${eventId}`);
  }
}
