"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncEvents = void 0;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const firestore_1 = require("firebase-admin/firestore");
const params_1 = require("firebase-functions/params");
const WA_CLIENT_ID = (0, params_1.defineString)("WILD_APRICOT_CLIENT_ID");
const WA_CLIENT_SECRET = (0, params_1.defineString)("WILD_APRICOT_CLIENT_SECRET");
const WA_ACCOUNT_ID = (0, params_1.defineString)("WILD_APRICOT_ACCOUNT_ID");
async function getWAToken() {
    const credentials = Buffer.from(`${WA_CLIENT_ID.value()}:${WA_CLIENT_SECRET.value()}`).toString("base64");
    const response = await fetch("https://oauth.wildapricot.org/auth/token", {
        method: "POST",
        headers: {
            Authorization: `Basic ${credentials}`,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials&scope=auto",
    });
    if (!response.ok)
        throw new Error(`WA auth failed: ${response.statusText}`);
    const data = await response.json();
    return data.access_token;
}
exports.syncEvents = (0, scheduler_1.onSchedule)({ schedule: "every 1 minutes", timeoutSeconds: 300 }, async () => {
    const db = (0, firestore_1.getFirestore)();
    const accessToken = await getWAToken();
    const accountId = WA_ACCOUNT_ID.value();
    const eventsUrl = `https://api.wildapricot.org/v2/accounts/${accountId}/events`;
    const response = await fetch(eventsUrl, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
        },
    });
    if (!response.ok) {
        console.error(`WA events fetch failed: ${response.statusText}`);
        return;
    }
    const data = await response.json();
    const events = data.Events || data || [];
    let added = 0;
    let skipped = 0;
    for (const event of events) {
        const eventId = String(event.Id);
        const docRef = db.collection("events").doc(eventId);
        const existing = await docRef.get();
        // INSERT ONLY — never overwrite existing events
        if (existing.exists) {
            skipped++;
            continue;
        }
        const startDate = event.StartDate
            ? event.StartDate.split("T")[0]
            : "";
        const endDate = event.EndDate ? event.EndDate.split("T")[0] : startDate;
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
            lastUpdated: firestore_1.Timestamp.now(),
            creationDate: firestore_1.Timestamp.now(),
        };
        await docRef.set(eventData);
        added++;
    }
    console.log(`syncEvents: ${added} new events added, ${skipped} skipped (already exist)`);
});
//# sourceMappingURL=sync-events.js.map