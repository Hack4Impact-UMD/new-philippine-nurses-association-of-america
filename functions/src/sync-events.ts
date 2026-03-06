import { onSchedule } from "firebase-functions/v2/scheduler";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { defineString } from "firebase-functions/params";

const WA_API_KEY = defineString("WILD_APRICOT_API_KEY");
const WA_ACCOUNT_ID = defineString("WILD_APRICOT_ACCOUNT_ID");

async function getWAToken(): Promise<string> {
  const credentials = Buffer.from(
    `APIKEY:${WA_API_KEY.value()}`
  ).toString("base64");

  const response = await fetch("https://oauth.wildapricot.org/auth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=auto",
  });

  if (!response.ok) throw new Error(`WA auth failed: ${response.statusText}`);
  const data = await response.json();
  return data.access_token;
}

export const syncEvents = onSchedule(
  { schedule: "every 1 minutes", timeoutSeconds: 300 },
  async () => {
    const db = getFirestore();
    const accessToken = await getWAToken();
    const accountId = WA_ACCOUNT_ID.value();

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
