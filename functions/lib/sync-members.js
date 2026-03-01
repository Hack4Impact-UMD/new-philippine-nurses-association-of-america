"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncMembers = void 0;
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
exports.syncMembers = (0, scheduler_1.onSchedule)({ schedule: "every 1 minutes", timeoutSeconds: 300 }, async () => {
    const db = (0, firestore_1.getFirestore)();
    const accessToken = await getWAToken();
    const accountId = WA_ACCOUNT_ID.value();
    // Fetch contacts from WA (paginated via async result)
    const contactsUrl = `https://api.wildapricot.org/v2/accounts/${accountId}/contacts?$async=false`;
    const response = await fetch(contactsUrl, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
        },
    });
    if (!response.ok) {
        console.error(`WA contacts fetch failed: ${response.statusText}`);
        return;
    }
    const data = await response.json();
    const contacts = data.Contacts || [];
    const batch = db.batch();
    let processed = 0;
    for (const contact of contacts) {
        const fieldValues = contact.FieldValues || [];
        const renewalDueDate = extractFieldValue(fieldValues, "Renewal due");
        const isActive = (() => {
            if (!renewalDueDate)
                return "Lapsed";
            const dueDate = new Date(renewalDueDate);
            return dueDate >= new Date() ? "Active" : "Lapsed";
        })();
        const memberId = extractFieldValue(fieldValues, "Member ID") || String(contact.Id);
        const memberData = {
            name: `${contact.FirstName || ""} ${contact.LastName || ""}`.trim(),
            email: contact.Email || "",
            membershipLevel: contact.MembershipLevel?.Name || "",
            renewalDueDate,
            chapterName: extractFieldValue(fieldValues, "Chapter (Active/Associate - 1 year)"),
            highestEducation: extractFieldValue(fieldValues, "Highest Level of Education"),
            memberId,
            region: extractFieldValue(fieldValues, "PNAA Region"),
            activeStatus: isActive,
            lastSynced: firestore_1.Timestamp.now(),
        };
        const docRef = db.collection("members").doc(memberId);
        batch.set(docRef, memberData, { merge: true });
        processed++;
        // Firestore batch limit is 500
        if (processed % 450 === 0) {
            await batch.commit();
        }
    }
    await batch.commit();
    console.log(`syncMembers: processed ${processed} contacts`);
});
//# sourceMappingURL=sync-members.js.map