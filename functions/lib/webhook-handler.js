"use strict";
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
 *     → fetch single contact from WA → upsert member → recalculate affected chapter(s)
 *   Event (Created)
 *     → insert into Firestore if not already present (INSERT ONLY, same as syncEvents)
 *   Event (Changed)
 *     → update WA-owned fields only (name, dates, location); app-managed fields preserved
 *   Event (Deleted)
 *     → soft-delete (archived: true)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.wildApricotWebhook = void 0;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const firestore_1 = require("firebase-admin/firestore");
const wa_utils_1 = require("./wa-utils");
const WEBHOOK_SECRET = (0, params_1.defineString)("WEBHOOK_SECRET");
exports.wildApricotWebhook = (0, https_1.onRequest)(async (req, res) => {
    if (req.method !== "POST") {
        res.status(405).send("Method Not Allowed");
        return;
    }
    // Validate secret token sent by WA as a query param
    const key = req.query["key"];
    if (!key || key !== WEBHOOK_SECRET.value()) {
        res.status(401).send("Unauthorized");
        return;
    }
    const body = req.body;
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
                const action = String(Parameters["Action"]);
                await handleEvent(eventId, action);
                break;
            }
            default:
                console.log(`wildApricotWebhook: unhandled MessageType "${MessageType}"`);
        }
    }
    catch (err) {
        // Always return 200 — returning non-200 would cause WA to retry indefinitely,
        // which could re-trigger the same transient error in a loop.
        console.error(`wildApricotWebhook: error processing ${MessageType}:`, err);
    }
    res.status(200).send("OK");
});
async function handleContact(waContactId) {
    const db = (0, firestore_1.getFirestore)();
    const token = await (0, wa_utils_1.getWAToken)();
    const accountId = (0, wa_utils_1.getWAAccountId)();
    const contact = await (0, wa_utils_1.fetchWAContact)(token, accountId, waContactId);
    if (!contact) {
        console.log(`wildApricotWebhook: contact ${waContactId} not found in WA`);
        return;
    }
    const member = (0, wa_utils_1.mapContactToMember)(contact);
    if (!member) {
        console.log(`wildApricotWebhook: contact ${waContactId} is archived, skipping`);
        return;
    }
    const docRef = db.collection("members").doc(member.memberId);
    // Read the old chapter before overwriting so we can recalculate it too if the
    // member moved chapters (otherwise that chapter's counts would stay stale).
    const oldDoc = await docRef.get();
    const oldChapterName = oldDoc.exists
        ? oldDoc.data()?.chapterName
        : undefined;
    await docRef.set(member, { merge: true });
    const chaptersToUpdate = new Set();
    if (member.chapterName)
        chaptersToUpdate.add(member.chapterName);
    if (oldChapterName && oldChapterName !== member.chapterName) {
        chaptersToUpdate.add(oldChapterName);
    }
    if (chaptersToUpdate.size > 0) {
        await (0, wa_utils_1.recalculateChapterAggregates)([...chaptersToUpdate]);
    }
    console.log(`wildApricotWebhook: updated member ${member.memberId} (${member.name})`);
}
async function handleEvent(eventId, action) {
    const db = (0, firestore_1.getFirestore)();
    const docRef = db.collection("events").doc(eventId);
    if (action === "Deleted") {
        const existing = await docRef.get();
        if (existing.exists) {
            await docRef.update({
                archived: true,
                lastUpdated: firestore_1.Timestamp.now(),
                lastUpdatedUser: "WildApricot",
            });
            console.log(`wildApricotWebhook: soft-deleted event ${eventId}`);
        }
        return;
    }
    const token = await (0, wa_utils_1.getWAToken)();
    const accountId = (0, wa_utils_1.getWAAccountId)();
    const event = await (0, wa_utils_1.fetchWAEvent)(token, accountId, eventId);
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
            lastUpdated: firestore_1.Timestamp.now(),
            creationDate: firestore_1.Timestamp.now(),
        });
        console.log(`wildApricotWebhook: inserted event ${eventId}`);
    }
    else {
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
            lastUpdated: firestore_1.Timestamp.now(),
            lastUpdatedUser: "WildApricot",
        });
        console.log(`wildApricotWebhook: updated event ${eventId}`);
    }
}
//# sourceMappingURL=webhook-handler.js.map