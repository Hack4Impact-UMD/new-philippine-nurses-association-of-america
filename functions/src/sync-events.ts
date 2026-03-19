import { onSchedule } from "firebase-functions/v2/scheduler";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getWAToken, getWAAccountId } from "./wa-utils";

// Run daily at 4 AM ET as a safety-net for any events missed by the webhook.
// Real-time event inserts, updates, and soft-deletes are handled by the
// wildApricotWebhook function.
export const syncEvents = onSchedule(
  { schedule: "every day 04:00", timeZone: "America/New_York", timeoutSeconds: 300 },
  async () => {
    const db = getFirestore();
    const accessToken = await getWAToken();
    const accountId = getWAAccountId();

    // Paginate through all WA events (stop when page < PAGE_SIZE = last page)
    const PAGE_SIZE = 100;
    let skip = 0;
    const allWAEvents: Record<string, unknown>[] = [];

    while (true) {
      const url =
        `https://api.wildapricot.org/v2/accounts/${accountId}/events` +
        `?$top=${PAGE_SIZE}&$skip=${skip}`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        console.error(
          `WA events fetch failed at skip=${skip}: ${response.statusText}`
        );
        break;
      }

      const data = await response.json();

      // WA events API may return a plain array or { Events: [...] }
      if (Array.isArray(data)) {
        allWAEvents.push(...(data as Record<string, unknown>[]));
        break;
      }

      const events: Record<string, unknown>[] = data.Events || [];
      if (events.length === 0) break;

      allWAEvents.push(...events);
      skip += events.length;
      if (events.length < PAGE_SIZE) break; // last page
    }

    // Load all existing event IDs from Firestore in one query (avoids N reads in the loop)
    const existingSnapshot = await db.collection("events").get();
    const existingIds = new Set(existingSnapshot.docs.map((doc) => doc.id));

    // Batch write only new events (INSERT ONLY — never overwrite existing)
    let batch = db.batch();
    let batchCount = 0;
    let added = 0;
    let skipped = 0;

    for (const event of allWAEvents) {
      const eventId = String(event.Id);

      if (existingIds.has(eventId)) {
        skipped++;
        continue;
      }

      const startDate = event.StartDate
        ? String(event.StartDate).split("T")[0]
        : "";
      const endDate = event.EndDate
        ? String(event.EndDate).split("T")[0]
        : startDate;

      const eventData = {
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
      };

      const docRef = db.collection("events").doc(eventId);
      batch.set(docRef, eventData);
      batchCount++;
      added++;

      if (batchCount === 450) {
        await batch.commit();
        batch = db.batch();
        batchCount = 0;
      }
    }

    if (batchCount > 0) {
      await batch.commit();
    }

    console.log(
      `syncEvents: ${added} new events added, ${skipped} skipped (already exist)`
    );
  }
);
