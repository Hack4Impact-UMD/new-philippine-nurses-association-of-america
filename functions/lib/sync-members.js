"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncMembers = void 0;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const firestore_1 = require("firebase-admin/firestore");
const wa_utils_1 = require("./wa-utils");
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
// Run daily at 3 AM ET as a full safety-net sync.
// Real-time updates are handled by the wildApricotWebhook function.
exports.syncMembers = (0, scheduler_1.onSchedule)({ schedule: "every day 03:00", timeZone: "America/New_York", timeoutSeconds: 540 }, async () => {
    const db = (0, firestore_1.getFirestore)();
    const accessToken = await (0, wa_utils_1.getWAToken)();
    const accountId = (0, wa_utils_1.getWAAccountId)();
    const now = new Date();
    const rawContacts = await fetchAllWAContacts(accessToken, accountId);
    const allMembers = [];
    for (const contact of rawContacts) {
        const member = (0, wa_utils_1.mapContactToMember)(contact);
        if (member)
            allMembers.push(member);
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
    // Aggregate chapters from the in-memory member list (most efficient for a full sync)
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
    // Fetch existing chapters to zero out any that lost all members
    const existingChaptersSnapshot = await db.collection("chapters").get();
    const chapterBatch = db.batch();
    for (const chapterDoc of existingChaptersSnapshot.docs) {
        const chapterData = chapterDoc.data();
        if (chapterData.name && !chapterCounts[chapterData.name]) {
            chapterBatch.update(chapterDoc.ref, {
                totalMembers: 0,
                totalActive: 0,
                totalLapsed: 0,
                lastUpdated: firestore_1.Timestamp.now(),
            });
        }
    }
    for (const [chapterName, counts] of Object.entries(chapterCounts)) {
        const chapterRef = db.collection("chapters").doc((0, wa_utils_1.chapterSlug)(chapterName));
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