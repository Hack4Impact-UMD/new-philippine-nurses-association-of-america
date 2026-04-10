import { onRequest } from "firebase-functions/v2/https";
import { defineString } from "firebase-functions/params";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getWAToken, getWAAccountId } from "./wa-utils";

const WEBHOOK_SECRET = defineString("WEBHOOK_SECRET");

// HTTP endpoint for manually triggering a full event sync.
// Real-time event inserts, updates, and soft-deletes are handled by the
// wildApricotWebhook function.
// Call with: POST /syncEvents?key=[WEBHOOK_SECRET]
export const syncEvents = onRequest(
  { timeoutSeconds: 300 },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    const key = req.query["key"] as string | undefined;
    if (!key || key !== WEBHOOK_SECRET.value()) {
      res.status(401).send("Unauthorized");
      return;
    }

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
        incompleteRegistrations: 0,
        registrations: 0,
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

    console.log(`syncEvents: ${added} new events added, ${skipped} skipped (already exist)`);

    //ATTENDEE FETCHING: 

    // Fields used for diffing attendee docs 
    // Matches Attendee data in typescript, but defined here as a plain type for easy runtime access
    type AttendeeData = {
      registrationId: string;
      eventId: string;
      contactId: string;
      name: string;
      registrationTypeId: string;
      registrationType: string;
      organization: string;
      isPaid: boolean;
      registrationFee: number;
      paidSum: number;
      OnWaitlist: boolean;
      Status: string;
    };

    // the list of fields to check for changes & update accordingly
    const FIELDS_TO_COMPARE: (keyof AttendeeData)[] = [
      "registrationId", "eventId", "contactId", "name",
      "registrationTypeId", "registrationType", "organization",
      "isPaid", "registrationFee", "paidSum", "OnWaitlist", "Status",
    ];

    // Counters — updated atomically after each chunk via returned values
    let totalAdded = 0;
    let totalUpdated = 0;
    let totalDeleted = 0;
    let totalRegistrations = 0;
    let totalIncomplete = 0;

    // PROCESSES ONE EVENT: 
    // fetch registrations and place that information in attendees

    // diff against Firestore, commit own batch
    async function processEvent(event: Record<string, unknown>): Promise<{
      added: number; updated: number; deleted: number;
      registrations: number; incomplete: number;
    }> {
      const eventId = String(event.Id);
      const eventRef = db.collection("events").doc(eventId);

      // Paginate through all registrations for this event by 100
      const REG_PAGE_SIZE = 100;
      let regSkip = 0;
      const allRegistrations: Record<string, unknown>[] = [];

      while (true) {
        const regUrl =
          `https://api.wildapricot.org/v2.1/Accounts/${accountId}/eventregistrations` +
          `?eventId=${eventId}&$top=${REG_PAGE_SIZE}&$skip=${regSkip}`;

        // check for event registrations
        const regResponse = await fetch(regUrl, {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        });

        // if no registrations, skip to next event.
        if (!regResponse.ok) {
          console.error(`Registrations fetch failed for event ${eventId} at skip=${regSkip}: ${regResponse.statusText}`);
          return { added: 0, updated: 0, deleted: 0, registrations: 0, incomplete: 0 };
        }

        // Successful response - registrations exist, and added to the allRegistrations array
        const regData = await regResponse.json();
        const page: Record<string, unknown>[] = Array.isArray(regData)
          ? regData
          : (regData.Registrations ?? []);


        allRegistrations.push(...page);
        regSkip += page.length;
        if (page.length < REG_PAGE_SIZE) break; // last page - end loop
      }

      // Build a Map of incoming WA registrations keyed by registrationId
      const waRegs = new Map<string, AttendeeData>();
      let eventIncomplete = 0;
      let totalRevenue = 0;


      for (const reg of allRegistrations) {
        // Extract data for each registration to prepare to put in registration
        const contact = (reg.Contact ?? {}) as Record<string, unknown>;
        const regEvent = (reg.Event ?? {}) as Record<string, unknown>;
        const regType = (reg.RegistrationType ?? {}) as Record<string, unknown>;
      
        const registrationId = String(reg.Id ?? "");
        const contactId = String(contact.Id ?? "");
        if (!registrationId || !contactId) continue;

        const status = String(reg.Status ?? "");

        // Count incomplete registrations for event-level metrics
        if (status !== "Paid" && status !== "Free") eventIncomplete++;
        totalRevenue += Number(reg.PaidSum ?? 0);

        // put registration info in REgs
        waRegs.set(registrationId, {
          registrationId,
          eventId: String(regEvent.Id ?? ""),
          contactId,
          name: String(reg.DisplayName ?? ""),
          registrationTypeId: String(regType.Id ?? ""),
          registrationType: String(regType.Name ?? ""),
          organization: String(reg.Organization ?? ""),
          isPaid: Boolean(reg.IsPaid ?? false),
          registrationFee: Number(reg.RegistrationFee ?? 0),
          paidSum: Number(reg.PaidSum ?? 0),
          OnWaitlist: Boolean(reg.OnWaitlist ?? false),
          Status: status,
        });
      }

      // Read existing attendees from Firestore
      const attendeeSnap = await eventRef.collection("attendees").get();
      const attendeeMap = new Map<string, Record<string, unknown>>();
      for (const doc of attendeeSnap.docs) attendeeMap.set(doc.id, doc.data());

      // Build and commit this event's batch
      let eventBatch = db.batch();
      let eventBatchCount = 0;
      let added = 0;
      let updated = 0;
      let deleted = 0;

      const commitIfFull = async () => {
        if (eventBatchCount >= 450) {
          await eventBatch.commit();
          eventBatch = db.batch();
          eventBatchCount = 0;
        }
      };

      // Diff attendees: add new, update changed, delete removed
      for (const [id, incoming] of waRegs) {
        const existing = attendeeMap.get(id);
        if (!existing) {
          eventBatch.set(eventRef.collection("attendees").doc(id), incoming);
          eventBatchCount++;
          added++;
        } else if (FIELDS_TO_COMPARE.some((f) => incoming[f] !== existing[f]
          )) {
          eventBatch.set(eventRef.collection("attendees").doc(id), incoming);
          eventBatchCount++;
          updated++;
        }
        await commitIfFull();
      }

      // Deletions: if an existing attendee's registrationId is not in the WA data,
      // it means it was deleted in WA and should be deleted in Firestore
      for (const [id] of attendeeMap) {
        if (!waRegs.has(id)) {
          eventBatch.delete(eventRef.collection("attendees").doc(id));
          eventBatchCount++;
          deleted++;
          await commitIfFull();
        }
      }

      // Update event-level counts
      eventBatch.update(eventRef, {
        registrations: waRegs.size,
        attendees: waRegs.size,
        incompleteRegistrations: eventIncomplete,
        totalRevenue: totalRevenue,
        lastUpdated: Timestamp.now(),
        lastUpdatedUser: "WildApricot",
      });
      eventBatchCount++;
      await commitIfFull();

      if (eventBatchCount > 0) await eventBatch.commit();

      return { added, updated, deleted, registrations: waRegs.size, incomplete: eventIncomplete };
    }

    // Process all events in chunks of 3 concurrently
    // - was an attempt to avoid the ECONNRESET error thrown 

    const CHUNK_SIZE = 3;
    for (let i = 0; i < allWAEvents.length; i += CHUNK_SIZE) {
      const chunk = allWAEvents.slice(i, i + CHUNK_SIZE);
      const results = await Promise.all(chunk.map(processEvent));
      for (const r of results) {
        totalAdded += r.added;
        totalUpdated += r.updated;
        totalDeleted += r.deleted;
        totalRegistrations += r.registrations;
        totalIncomplete += r.incomplete;
      }
    }

    const msg =
      `syncEvents: ${added} new events added, ${skipped} skipped; ` +
      `registrations: ${totalRegistrations}, incomplete: ${totalIncomplete}; ` +
      `writes: ${totalAdded} added, ${totalUpdated} updated, ${totalDeleted} deleted`;
    console.log(msg);
    res.status(200).send(msg);
  }
);
