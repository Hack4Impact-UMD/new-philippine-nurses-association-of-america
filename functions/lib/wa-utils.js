"use strict";
/**
 * Shared Wild Apricot utilities used by scheduled sync functions and the webhook handler.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWAAccountId = getWAAccountId;
exports.getWAToken = getWAToken;
exports.extractFieldValue = extractFieldValue;
exports.extractChapterName = extractChapterName;
exports.mapContactToMember = mapContactToMember;
exports.fetchWAContact = fetchWAContact;
exports.fetchWAEvent = fetchWAEvent;
exports.fetchWAEventRegistrations = fetchWAEventRegistrations;
exports.fetchWARegistration = fetchWARegistration;
exports.chapterSlug = chapterSlug;
exports.recalculateChapterAggregates = recalculateChapterAggregates;
const firestore_1 = require("firebase-admin/firestore");
const params_1 = require("firebase-functions/params");
const WA_API_KEY = (0, params_1.defineString)("WILD_APRICOT_API_KEY");
const WA_ACCOUNT_ID = (0, params_1.defineString)("WILD_APRICOT_ACCOUNT_ID");
function getWAAccountId() {
    return WA_ACCOUNT_ID.value();
}
async function getWAToken() {
    const credentials = Buffer.from(`APIKEY:${WA_API_KEY.value()}`).toString("base64");
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
function extractFieldValue(fieldValues, fieldName) {
    const field = fieldValues.find((f) => f.FieldName === fieldName);
    if (!field || field.Value === null || field.Value === undefined)
        return "";
    if (typeof field.Value === "object" &&
        field.Value !== null &&
        "Label" in field.Value) {
        return field.Value.Label;
    }
    return String(field.Value);
}
function extractChapterName(fieldValues) {
    const chapterFields = fieldValues.filter((f) => f.FieldName.includes("Chapter"));
    for (const field of chapterFields) {
        if (field.Value === null || field.Value === undefined)
            continue;
        let value;
        if (typeof field.Value === "object" &&
            "Label" in field.Value) {
            value = field.Value.Label;
        }
        else {
            value = String(field.Value);
        }
        if (value)
            return value;
    }
    return "";
}
/** Maps a raw WA contact object to MemberData. Returns null for archived contacts. */
function mapContactToMember(contact) {
    const fieldValues = contact.FieldValues || [];
    const isArchived = fieldValues.find((f) => f.FieldName === "Archived")?.Value === true;
    if (isArchived)
        return null;
    const now = new Date();
    const renewalDueDate = extractFieldValue(fieldValues, "Renewal due");
    const activeStatus = renewalDueDate && new Date(renewalDueDate) >= now ? "Active" : "Lapsed";
    const memberId = extractFieldValue(fieldValues, "Member ID") || String(contact.Id);
    const membershipLevel = contact.MembershipLevel &&
        typeof contact.MembershipLevel === "object" &&
        "Name" in contact.MembershipLevel
        ? String(contact.MembershipLevel.Name)
        : "";
    return {
        name: `${contact.FirstName || ""} ${contact.LastName || ""}`.trim(),
        email: String(contact.Email || ""),
        membershipLevel,
        renewalDueDate,
        chapterName: extractChapterName(fieldValues),
        highestEducation: extractFieldValue(fieldValues, "Highest Level of Education"),
        memberId,
        region: extractFieldValue(fieldValues, "PNAA Region"),
        activeStatus,
        lastSynced: firestore_1.Timestamp.now(),
    };
}
/** Fetches a single WA contact by their WA contact ID. Returns null if not found. */
async function fetchWAContact(accessToken, accountId, contactId) {
    const url = `https://api.wildapricot.org/v2/accounts/${accountId}/contacts/${contactId}`;
    const response = await fetch(url, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
        },
    });
    if (!response.ok) {
        if (response.status === 404)
            return null;
        throw new Error(`WA contact fetch failed (${contactId}): ${response.statusText}`);
    }
    return response.json();
}
/** Fetches a single WA event by its event ID. Returns null if not found. */
async function fetchWAEvent(accessToken, accountId, eventId) {
    const url = `https://api.wildapricot.org/v2/accounts/${accountId}/events/${eventId}`;
    const response = await fetch(url, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
        },
    });
    if (!response.ok) {
        if (response.status === 404)
            return null;
        throw new Error(`WA event fetch failed (${eventId}): ${response.statusText}`);
    }
    return response.json();
}
/**
 * Fetches all registrations for a single WA event.
 * Used by the webhook handler for per-event attendee sync.
 * Returns [] on 404 or empty response.
 */
async function fetchWAEventRegistrations(accessToken, accountId, eventId) {
    const url = `https://api.wildapricot.org/v2.1/Accounts/${accountId}/eventregistrations` +
        `?eventId=${eventId}`;
    const response = await fetch(url, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
        },
    });
    if (!response.ok) {
        if (response.status === 404)
            return [];
        throw new Error(`WA event registrations fetch failed (event ${eventId}): ${response.statusText}`);
    }
    const data = await response.json();
    const registrations = Array.isArray(data)
        ? data
        : (data.Registrations ?? []);
    return registrations.map((reg) => {
        const contact = (reg.Contact ?? {});
        const regType = (reg.RegistrationType ?? {});
        const event = (reg.Event ?? {});
        return {
            registrationId: String(reg.Id ?? ""),
            eventId: String(event.Id ?? ""),
            contactId: String(contact.Id ?? ""),
            name: String(contact.Name ?? ""),
            registrationTypeId: String(reg.RegistrationTypeId ?? ""),
            registrationType: String(regType.Name ?? ""),
            organization: String(reg.Organization ?? ""),
            isPaid: Boolean(reg.IsPaid ?? false),
            registrationFee: Number(reg.RegistrationFee ?? 0),
            paidSum: Number(reg.PaidSum ?? 0),
            OnWaitlist: Boolean(reg.OnWaitlist ?? false),
            Status: String(reg.Status ?? ""),
        };
    });
}
/**
 * Fetches a single WA event registration by its registration ID.
 * Used by the webhook handler for Created/Changed/Deleted registration events.
 * Returns null if not found.
 */
async function fetchWARegistration(accessToken, accountId, registrationId) {
    const url = `https://api.wildapricot.org/v2.1/Accounts/${accountId}/eventregistrations/${registrationId}`;
    const response = await fetch(url, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
        },
    });
    if (!response.ok) {
        if (response.status === 404)
            return null;
        throw new Error(`WA registration fetch failed (${registrationId}): ${response.statusText}`);
    }
    const reg = await response.json();
    const contact = (reg.Contact ?? {});
    const regType = (reg.RegistrationType ?? {});
    const event = (reg.Event ?? {});
    return {
        registrationId: String(reg.Id ?? ""),
        eventId: String(event.Id ?? ""),
        contactId: String(contact.Id ?? ""),
        name: String(reg.DisplayName ?? contact.Name ?? ""),
        registrationTypeId: String(reg.RegistrationTypeId ?? ""),
        registrationType: String(regType.Name ?? ""),
        organization: String(reg.Organization ?? ""),
        isPaid: Boolean(reg.IsPaid ?? false),
        registrationFee: Number(reg.RegistrationFee ?? 0),
        paidSum: Number(reg.PaidSum ?? 0),
        OnWaitlist: Boolean(reg.OnWaitlist ?? false),
        Status: String(reg.Status ?? ""),
    };
}
/** Converts a chapter name to its Firestore document slug. */
function chapterSlug(chapterName) {
    return chapterName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
}
/**
 * Recalculates chapter aggregates for the given chapter names by re-querying
 * Firestore members. Used by the webhook handler for targeted per-contact updates.
 */
async function recalculateChapterAggregates(chapterNames) {
    const db = (0, firestore_1.getFirestore)();
    const now = new Date();
    const batch = db.batch();
    for (const chapterName of chapterNames) {
        const membersSnap = await db
            .collection("members")
            .where("chapterName", "==", chapterName)
            .get();
        let totalMembers = 0;
        let totalActive = 0;
        let totalLapsed = 0;
        let region = "";
        for (const doc of membersSnap.docs) {
            const m = doc.data();
            totalMembers++;
            if (m.renewalDueDate && new Date(m.renewalDueDate) >= now) {
                totalActive++;
            }
            else {
                totalLapsed++;
            }
            if (!region && m.region)
                region = m.region;
        }
        const slug = chapterSlug(chapterName);
        const chapterRef = db.collection("chapters").doc(slug);
        batch.set(chapterRef, {
            name: chapterName,
            region,
            totalMembers,
            totalActive,
            totalLapsed,
            lastUpdated: firestore_1.Timestamp.now(),
        }, { merge: true });
    }
    await batch.commit();
}
//# sourceMappingURL=wa-utils.js.map