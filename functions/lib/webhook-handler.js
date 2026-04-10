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
 *     → fetch single contact from WA → upsert member → increment chapter aggregates
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
            case "EventRegistration": {
                const eventId = String(Parameters["EventToRegister.Id"]);
                const registrationId = String(Parameters["Registration.Id"]);
                const action = String(Parameters["Action"]);
                // Registration.Status is absent for Deleted actions
                const webhookStatus = action !== "Deleted"
                    ? String(Parameters["Registration.Status"] ?? "")
                    : null;
                await handleEventRegistration(eventId, registrationId, action, webhookStatus);
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
    // Read old state before overwriting so we can compute the exact chapter delta
    const oldDoc = await docRef.get();
    const isNewMember = !oldDoc.exists;
    const oldChapterName = isNewMember ? "" : (oldDoc.data()?.chapterName || "");
    const oldActiveStatus = isNewMember
        ? null
        : (oldDoc.data()?.activeStatus || "Lapsed");
    await docRef.set(member, { merge: true });
    const newChapterName = member.chapterName || "";
    const newActiveStatus = member.activeStatus;
    const chapterBatch = db.batch();
    let chapterUpdates = 0;
    if (oldChapterName && oldChapterName !== newChapterName) {
        // Member left this chapter — decrement their contribution
        const oldChapterRef = db.collection("chapters").doc((0, wa_utils_1.chapterSlug)(oldChapterName));
        chapterBatch.set(oldChapterRef, {
            totalMembers: firestore_1.FieldValue.increment(-1),
            ...(oldActiveStatus === "Active" && { totalActive: firestore_1.FieldValue.increment(-1) }),
            ...(oldActiveStatus === "Lapsed" && { totalLapsed: firestore_1.FieldValue.increment(-1) }),
            lastUpdated: firestore_1.Timestamp.now(),
        }, { merge: true });
        chapterUpdates++;
    }
    if (newChapterName) {
        const newChapterRef = db.collection("chapters").doc((0, wa_utils_1.chapterSlug)(newChapterName));
        if (isNewMember || oldChapterName !== newChapterName) {
            // Member joined this chapter (new member or chapter transfer)
            chapterBatch.set(newChapterRef, {
                name: newChapterName,
                region: member.region,
                totalMembers: firestore_1.FieldValue.increment(1),
                ...(newActiveStatus === "Active" && { totalActive: firestore_1.FieldValue.increment(1) }),
                ...(newActiveStatus === "Lapsed" && { totalLapsed: firestore_1.FieldValue.increment(1) }),
                lastUpdated: firestore_1.Timestamp.now(),
            }, { merge: true });
            chapterUpdates++;
        }
        else if (oldActiveStatus !== newActiveStatus) {
            // Same chapter, status changed (e.g. admin-triggered renewal or lapse)
            const activeDelta = newActiveStatus === "Active" ? 1 : -1;
            chapterBatch.set(newChapterRef, {
                name: newChapterName,
                region: member.region,
                totalActive: firestore_1.FieldValue.increment(activeDelta),
                totalLapsed: firestore_1.FieldValue.increment(-activeDelta),
                lastUpdated: firestore_1.Timestamp.now(),
            }, { merge: true });
            chapterUpdates++;
        }
        // else: same chapter, same status — no chapter update needed
    }
    if (chapterUpdates > 0)
        await chapterBatch.commit();
    console.log(`wildApricotWebhook: updated member ${member.memberId} (${member.name})`);
}
async function handleEventRegistration(eventId, registrationId, action, webhookStatus) {
    console.log(`wildApricotWebhook [EventRegistration]: action=${action} eventId=${eventId} registrationId=${registrationId} webhookStatus=${webhookStatus ?? "absent"}`);
    const db = (0, firestore_1.getFirestore)();
    const eventRef = db.collection("events").doc(eventId);
    // Doc ID is registrationId — Deleted can target it directly without a Firestore query
    const attendeeRef = eventRef.collection("attendees").doc(registrationId);
    // Deleted: remove the element.
    if (action === "Deleted") {
        console.log(`wildApricotWebhook [EventRegistration/Deleted]: check  if attendee doc ${registrationId} exists`);
        const existing = await attendeeRef.get();
        if (!existing.exists) {
            console.log(`wildApricotWebhook [EventRegistration/Deleted]: attendee ${registrationId} not found in Firestore — nothing to delete`);
            return;
        }
        const existingData = existing.data() ?? {};
        const oldPaidSum = Number(existingData.paidSum ?? 0);
        const oldStatus = String(existingData.Status ?? "");
        const wasIncomplete = oldStatus !== "Paid" && oldStatus !== "Free";
        const batch = db.batch();
        batch.delete(attendeeRef);
        const eventDoc = await eventRef.get();
        if (!eventDoc.exists) {
            console.log(`wildApricotWebhook [EventRegistration/Deleted]: event ${eventId} not found — deleting orphaned attendee only`);
            await attendeeRef.delete();
            return;
        }
        batch.update(eventRef, {
            attendees: firestore_1.FieldValue.increment(-1),
            registrations: firestore_1.FieldValue.increment(-1),
            ...(oldPaidSum !== 0 && { totalRevenue: firestore_1.FieldValue.increment(-oldPaidSum) }),
            ...(wasIncomplete && { incompleteRegistrations: firestore_1.FieldValue.increment(-1) }),
            lastUpdated: firestore_1.Timestamp.now(),
            lastUpdatedUser: "WildApricot",
        });
        await batch.commit();
        console.log(`wildApricotWebhook [EventRegistration/Deleted]: deleted attendee ${registrationId} from event ${eventId}, revenue: -${oldPaidSum}, incomplete: ${wasIncomplete ? "-1" : "0"})`);
        return;
    }
    console.log(`wildApricotWebhook [EventRegistration/${action}]: fetching registration ${registrationId} from WA`);
    const token = await (0, wa_utils_1.getWAToken)();
    const accountId = (0, wa_utils_1.getWAAccountId)();
    const registration = await (0, wa_utils_1.fetchWARegistration)(token, accountId, registrationId);
    if (!registration) {
        console.error(`wildApricotWebhook [EventRegistration/${action}]: registration ${registrationId} not found in WA (404) — skipping`);
        return;
    }
    console.log(`wildApricotWebhook [EventRegistration/${action}]: fetched registration — name="${registration.name}" contactId=${registration.contactId} status=${registration.Status}`);
    const attendeeData = {
        registrationId: registration.registrationId,
        eventId: registration.eventId,
        contactId: registration.contactId,
        name: registration.name,
        registrationTypeId: registration.registrationTypeId,
        registrationType: registration.registrationType,
        organization: registration.organization,
        isPaid: registration.isPaid,
        registrationFee: registration.registrationFee,
        paidSum: registration.paidSum,
        OnWaitlist: registration.OnWaitlist,
        Status: webhookStatus ?? registration.Status,
    };
    const newPaidSum = attendeeData.paidSum;
    const newStatus = attendeeData.Status;
    const newIsIncomplete = newStatus !== "Paid" && newStatus !== "Free";
    if (action === "Created") {
        console.log(`wildApricotWebhook [EventRegistration/Created]: checking if attendee doc ${registrationId} already exists`);
        const existingAttendee = await attendeeRef.get();
        if (existingAttendee.exists) {
            console.log(`wildApricotWebhook [EventRegistration/Created]: attendee ${registrationId} already exists — updating without incrementing count`);
            await attendeeRef.set(attendeeData);
            return;
        }
        console.log(`wildApricotWebhook [EventRegistration/Created]: checking event doc ${eventId} exists`);
        const eventDoc = await eventRef.get();
        if (!eventDoc.exists) {
            console.error(`wildApricotWebhook [EventRegistration/Created]: event ${eventId} not found in Firestore — skipping attendee creation`);
            return;
        }
        const batch = db.batch();
        batch.set(attendeeRef, attendeeData);
        batch.update(eventRef, {
            attendees: firestore_1.FieldValue.increment(1),
            registrations: firestore_1.FieldValue.increment(1),
            ...(newPaidSum !== 0 && { totalRevenue: firestore_1.FieldValue.increment(newPaidSum) }),
            ...(newIsIncomplete && { incompleteRegistrations: firestore_1.FieldValue.increment(1) }),
            lastUpdated: firestore_1.Timestamp.now(),
            lastUpdatedUser: "WildApricot",
        });
        await batch.commit();
        console.log(`wildApricotWebhook [EventRegistration/Created]: added attendee ${registrationId} to event ${eventId} (revenue: +${newPaidSum}, incomplete: ${newIsIncomplete ? "+1" : "0"})`);
    }
    else {
        // Changed — overwrite doc, compute deltas against old Firestore values
        console.log(`wildApricotWebhook [EventRegistration/Changed]: checking if attendee doc ${registrationId} exists`);
        const [existingAttendee, eventDoc] = await Promise.all([attendeeRef.get(), eventRef.get()]);
        if (!existingAttendee.exists) {
            console.error(`wildApricotWebhook [EventRegistration/Changed]: attendee ${registrationId} not found in Firestore — skipping update`);
            return;
        }
        if (!eventDoc.exists) {
            console.error(`wildApricotWebhook [EventRegistration/Changed]: event ${eventId} not found in Firestore — updating attendee only`);
            await attendeeRef.set(attendeeData);
            return;
        }
        const oldData = existingAttendee.data() ?? {};
        const oldPaidSum = Number(oldData.paidSum ?? 0);
        const oldStatus = String(oldData.Status ?? "");
        const oldIsIncomplete = oldStatus !== "Paid" && oldStatus !== "Free";
        const revenueDelta = newPaidSum - oldPaidSum;
        const incompleteDelta = (newIsIncomplete ? 1 : 0) - (oldIsIncomplete ? 1 : 0);
        const batch = db.batch();
        batch.set(attendeeRef, attendeeData);
        batch.update(eventRef, {
            ...(revenueDelta !== 0 && { totalRevenue: firestore_1.FieldValue.increment(revenueDelta) }),
            ...(incompleteDelta !== 0 && { incompleteRegistrations: firestore_1.FieldValue.increment(incompleteDelta) }),
            lastUpdated: firestore_1.Timestamp.now(),
            lastUpdatedUser: "WildApricot",
        });
        await batch.commit();
        console.log(`wildApricotWebhook [EventRegistration/Changed]: updated attendee ${registrationId} on event ${eventId} (revenueDelta: ${revenueDelta}, incompleteDelta: ${incompleteDelta})`);
    }
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