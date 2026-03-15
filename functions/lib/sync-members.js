"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncMembers = void 0;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const firestore_1 = require("firebase-admin/firestore");
const params_1 = require("firebase-functions/params");
const WA_API_KEY = (0, params_1.defineString)("WILD_APRICOT_API_KEY");
const WA_ACCOUNT_ID = (0, params_1.defineString)("WILD_APRICOT_ACCOUNT_ID");
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
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
/**
 * WA contacts API uses an async job system for large result sets.
 * 1. Make a request → WA returns a ResultUrl (job may be InProgress).
 * 2. Poll ResultUrl until State === "Complete".
 * 3. Paginate through the completed result using $top/$skip on the ResultUrl.
 */
async function fetchAllWAContacts(accessToken, accountId) {
    const authHeaders = {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
    };
    // Step 1: Initiate the contacts request
    const initUrl = `https://api.wildapricot.org/v2/accounts/${accountId}/contacts`;
    const initResponse = await fetch(initUrl, { headers: authHeaders });
    if (!initResponse.ok) {
        throw new Error(`WA contacts request failed: ${initResponse.statusText}`);
    }
    let data = (await initResponse.json());
    // Step 2: Poll until State === "Complete"
    // WA can take several minutes for large accounts; poll up to 8 minutes
    const resultUrl = data.ResultUrl;
    if (resultUrl && data.State !== "Complete") {
        console.log("syncMembers: waiting for WA contacts job...");
        for (let attempt = 0; attempt < 96; attempt++) {
            await sleep(5000);
            const pollResponse = await fetch(resultUrl, { headers: authHeaders });
            if (!pollResponse.ok) {
                throw new Error(`WA contacts poll failed: ${pollResponse.statusText}`);
            }
            data = (await pollResponse.json());
            if (data.State === "Complete")
                break;
        }
        if (data.State !== "Complete") {
            throw new Error(`WA contacts async job timed out (last state: ${data.State})`);
        }
    }
    const totalCount = data.ResultCount || 0;
    console.log(`syncMembers: ${totalCount} total contacts`);
    // Step 3: Paginate through results using ResultUrl with $top/$skip
    const PAGE_SIZE = 100;
    const allContacts = [];
    let skip = 0;
    const baseUrl = resultUrl || initUrl;
    while (true) {
        const separator = baseUrl.includes("?") ? "&" : "?";
        const pageUrl = `${baseUrl}${separator}$top=${PAGE_SIZE}&$skip=${skip}`;
        const pageResponse = await fetch(pageUrl, { headers: authHeaders });
        if (!pageResponse.ok) {
            console.error(`WA contacts page failed at skip=${skip}: ${pageResponse.statusText}`);
            break;
        }
        const pageData = (await pageResponse.json());
        const contacts = pageData.Contacts || [];
        if (contacts.length === 0)
            break;
        allContacts.push(...contacts);
        skip += contacts.length;
        if (contacts.length < PAGE_SIZE)
            break; // last page
    }
    return allContacts;
}
exports.syncMembers = (0, scheduler_1.onSchedule)({ schedule: "every 1 minutes", timeoutSeconds: 540 }, async () => {
    const db = (0, firestore_1.getFirestore)();
    const accessToken = await getWAToken();
    const accountId = WA_ACCOUNT_ID.value();
    const now = new Date();
    const rawContacts = await fetchAllWAContacts(accessToken, accountId);
    const allMembers = [];
    for (const contact of rawContacts) {
        const fieldValues = contact.FieldValues || [];
        // Skip archived contacts
        const isArchived = fieldValues.find((f) => f.FieldName === "Archived")?.Value === true;
        if (isArchived)
            continue;
        const renewalDueDate = extractFieldValue(fieldValues, "Renewal due");
        const activeStatus = renewalDueDate && new Date(renewalDueDate) >= now ? "Active" : "Lapsed";
        const memberId = extractFieldValue(fieldValues, "Member ID") || String(contact.Id);
        const membershipLevel = contact.MembershipLevel &&
            typeof contact.MembershipLevel === "object" &&
            "Name" in contact.MembershipLevel
            ? String(contact.MembershipLevel.Name)
            : "";
        allMembers.push({
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
        });
    }
    // Write all members to Firestore in batches of 450
    let batch = db.batch();
    let batchCount = 0;
    let processed = 0;
    for (const memberData of allMembers) {
        const docRef = db.collection("members").doc(memberData.memberId);
        batch.set(docRef, memberData, { merge: true });
        batchCount++;
        processed++;
        if (batchCount === 450) {
            await batch.commit();
            batch = db.batch();
            batchCount = 0;
        }
    }
    if (batchCount > 0) {
        await batch.commit();
    }
    // Aggregate chapters inline so chapter data updates every sync cycle
    const chapterCounts = {};
    for (const member of allMembers) {
        if (!member.chapterName)
            continue;
        if (!chapterCounts[member.chapterName]) {
            chapterCounts[member.chapterName] = {
                totalMembers: 0,
                totalActive: 0,
                totalLapsed: 0,
                region: member.region,
            };
        }
        chapterCounts[member.chapterName].totalMembers++;
        const isActive = member.renewalDueDate && new Date(member.renewalDueDate) >= now;
        if (isActive) {
            chapterCounts[member.chapterName].totalActive++;
        }
        else {
            chapterCounts[member.chapterName].totalLapsed++;
        }
    }
    const chapterBatch = db.batch();
    for (const [chapterName, counts] of Object.entries(chapterCounts)) {
        const slug = chapterName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)/g, "");
        const chapterRef = db.collection("chapters").doc(slug);
        chapterBatch.set(chapterRef, {
            name: chapterName,
            region: counts.region,
            totalMembers: counts.totalMembers,
            totalActive: counts.totalActive,
            totalLapsed: counts.totalLapsed,
            lastUpdated: firestore_1.Timestamp.now(),
        }, { merge: true });
    }
    await chapterBatch.commit();
    console.log(`syncMembers: processed ${processed} contacts, ` +
        `updated ${Object.keys(chapterCounts).length} chapters`);
});
//# sourceMappingURL=sync-members.js.map