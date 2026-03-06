"use strict";
/**
 * Local runner — syncs members, chapters, and events directly to production Firestore.
 *
 * Usage (from functions/ directory):
 *   npm run sync                          # sync everything
 *   npm run sync:members                  # sync all members + chapters
 *   npm run sync:events                   # sync all events
 *
 *   node lib/run-sync.js members --from 5000          # start at contact #5000
 *   node lib/run-sync.js members --from 5000 --limit 3000  # process 3000 contacts starting at #5000
 *   node lib/run-sync.js members --limit 1000         # process only the first 1000 contacts
 *
 * Chapters are always aggregated from ALL members already in Firestore,
 * so partial runs still produce accurate chapter counts.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const path = __importStar(require("path"));
const dotenv = __importStar(require("dotenv"));
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
// Load WA credentials from functions/.env
dotenv.config({ path: path.resolve(__dirname, "../.env") });
// Initialize Admin SDK with the production service account
const serviceAccount = require(path.resolve(__dirname, "../../pnaa-chapter-management-firebase-adminsdk-fbsvc-fc1a5f5216.json"));
(0, app_1.initializeApp)({ credential: (0, app_1.cert)(serviceAccount) });
const db = (0, firestore_1.getFirestore)();
const WA_API_KEY = process.env.WILD_APRICOT_API_KEY;
const WA_ACCOUNT_ID = process.env.WILD_APRICOT_ACCOUNT_ID;
// ─── Argument parsing ────────────────────────────────────────────────────────
function parseArgs() {
    const args = process.argv.slice(2);
    let from = 0;
    let limit = Infinity;
    for (let i = 0; i < args.length; i++) {
        if ((args[i] === "--from" || args[i] === "--skip") && args[i + 1]) {
            from = parseInt(args[++i], 10);
        }
        else if (args[i] === "--limit" && args[i + 1]) {
            limit = parseInt(args[++i], 10);
        }
    }
    return { from, limit };
}
// ─── Helpers ────────────────────────────────────────────────────────────────
async function getWAToken() {
    const credentials = Buffer.from(`APIKEY:${WA_API_KEY}`).toString("base64");
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
        "Label" in field.Value) {
        return field.Value.Label;
    }
    return String(field.Value);
}
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
/**
 * WA contacts API uses an async job system for large result sets.
 * 1. Make a request → WA returns a ResultUrl (job may be InProgress).
 * 2. Poll ResultUrl until State === "Complete".
 * 3. Paginate through the completed result using $top/$skip on the ResultUrl.
 *
 * @param startFrom  Skip this many contacts in WA before starting (default 0)
 * @param maxContacts  Stop after collecting this many contacts (default unlimited)
 */
async function fetchWAContacts(accessToken, startFrom = 0, maxContacts = Infinity) {
    const authHeaders = {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
    };
    // Step 1: Initiate the contacts request
    const initUrl = `https://api.wildapricot.org/v2/accounts/${WA_ACCOUNT_ID}/contacts`;
    const initResponse = await fetch(initUrl, { headers: authHeaders });
    if (!initResponse.ok) {
        throw new Error(`WA contacts request failed: ${initResponse.statusText}`);
    }
    let data = (await initResponse.json());
    // Step 2: Poll until State === "Complete" (WA caches the result for reuse)
    const resultUrl = data.ResultUrl;
    if (resultUrl && data.State !== "Complete") {
        process.stdout.write("  Waiting for WA to prepare contacts result");
        // WA can take 2–5 minutes for large accounts; poll up to 10 minutes
        for (let attempt = 0; attempt < 120; attempt++) {
            await sleep(5000);
            const pollResponse = await fetch(resultUrl, { headers: authHeaders });
            if (!pollResponse.ok) {
                throw new Error(`WA contacts poll failed: ${pollResponse.statusText}`);
            }
            data = (await pollResponse.json());
            process.stdout.write(".");
            if (data.State === "Complete")
                break;
        }
        console.log(); // newline after dots
        if (data.State !== "Complete") {
            throw new Error(`WA contacts async job timed out (last state: ${data.State})`);
        }
    }
    const totalCount = data.ResultCount || 0;
    console.log(`  WA job complete. ResultCount=${totalCount}, keys=${Object.keys(data).join(",")}`);
    // Step 3: Paginate through results using ResultUrl with $top/$skip
    const PAGE_SIZE = 100;
    const allContacts = [];
    const seenIds = new Set();
    let skip = startFrom; // honour --from flag
    const baseUrl = resultUrl || initUrl;
    while (allContacts.length < maxContacts) {
        const remaining = Math.min(PAGE_SIZE, maxContacts - allContacts.length);
        const separator = baseUrl.includes("?") ? "&" : "?";
        const pageUrl = `${baseUrl}${separator}$top=${remaining}&$skip=${skip}`;
        const pageResponse = await fetch(pageUrl, { headers: authHeaders });
        if (!pageResponse.ok) {
            console.error(`Contacts page failed at skip=${skip}: ${pageResponse.statusText}`);
            break;
        }
        const pageData = (await pageResponse.json());
        const contacts = pageData.Contacts || [];
        if (contacts.length === 0)
            break;
        // Detect if $skip is being ignored (same contacts returned every page)
        const firstId = String(contacts[0].Id ?? "?");
        const lastId = String(contacts[contacts.length - 1].Id ?? "?");
        console.log(`  Page skip=${skip}: got ${contacts.length} contacts, IDs ${firstId}..${lastId}`);
        const allDupes = contacts.every((c) => seenIds.has(String(c.Id)));
        if (allDupes) {
            console.error("  ERROR: WA returned duplicate contacts ($skip is being ignored). Stopping.");
            break;
        }
        for (const c of contacts)
            seenIds.add(String(c.Id));
        allContacts.push(...contacts);
        skip += contacts.length;
        if (contacts.length < remaining)
            break; // last page
    }
    console.log(`  Total unique contacts fetched: ${allContacts.length}`);
    return allContacts;
}
// ─── Sync Members + Chapters ─────────────────────────────────────────────────
async function runSyncMembers(startFrom, limit) {
    const isPartial = startFrom > 0 || limit < Infinity;
    console.log(`\n=== Syncing members & chapters${isPartial ? ` (from=${startFrom}, limit=${limit})` : ""} ===`);
    const accessToken = await getWAToken();
    const now = new Date();
    const rawContacts = await fetchWAContacts(accessToken, startFrom, limit);
    console.log(`\n  Processing ${rawContacts.length} contacts...`);
    const allMembers = [];
    for (const contact of rawContacts) {
        const fieldValues = contact.FieldValues || [];
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
            chapterName: extractFieldValue(fieldValues, "Chapter (Active/Associate - 1 year)"),
            highestEducation: extractFieldValue(fieldValues, "Highest Level of Education"),
            memberId,
            region: extractFieldValue(fieldValues, "PNAA Region"),
            activeStatus,
            lastSynced: firestore_1.Timestamp.now(),
        });
    }
    // Write members to Firestore in batches of 450
    console.log(`  Writing ${allMembers.length} members to Firestore...`);
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
            console.log(`  Committed ${processed} members...`);
        }
    }
    if (batchCount > 0)
        await batch.commit();
    console.log(`  ✓ ${processed} members written to Firestore`);
    // Aggregate chapters from ALL Firestore members (not just this batch),
    // so partial runs still produce accurate chapter counts.
    console.log("  Aggregating chapters from all Firestore members...");
    const membersSnapshot = await db.collection("members").get();
    const chapterCounts = {};
    for (const doc of membersSnapshot.docs) {
        const member = doc.data();
        if (!member.chapterName)
            continue;
        if (!chapterCounts[member.chapterName]) {
            chapterCounts[member.chapterName] = {
                totalMembers: 0,
                totalActive: 0,
                totalLapsed: 0,
                region: member.region || "",
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
        chapterBatch.set(db.collection("chapters").doc(slug), {
            name: chapterName,
            region: counts.region,
            totalMembers: counts.totalMembers,
            totalActive: counts.totalActive,
            totalLapsed: counts.totalLapsed,
            lastUpdated: firestore_1.Timestamp.now(),
        }, { merge: true });
    }
    await chapterBatch.commit();
    console.log(`✓ Members: ${processed} written, ${Object.keys(chapterCounts).length} chapters updated` +
        ` (aggregated from ${membersSnapshot.size} total Firestore members)`);
}
// ─── Sync Events ─────────────────────────────────────────────────────────────
async function runSyncEvents() {
    console.log("\n=== Syncing events ===");
    const accessToken = await getWAToken();
    const PAGE_SIZE = 100;
    let skip = 0;
    const allWAEvents = [];
    while (true) {
        const url = `https://api.wildapricot.org/v2/accounts/${WA_ACCOUNT_ID}/events` +
            `?$top=${PAGE_SIZE}&$skip=${skip}`;
        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        });
        if (!response.ok) {
            console.error(`Events fetch failed at skip=${skip}: ${response.statusText}`);
            break;
        }
        const data = await response.json();
        if (Array.isArray(data)) {
            allWAEvents.push(...data);
            break;
        }
        const events = data.Events || [];
        if (events.length === 0)
            break;
        allWAEvents.push(...events);
        skip += events.length;
        process.stdout.write(`  Fetched ${skip} events so far...\r`);
        if (events.length < PAGE_SIZE)
            break;
    }
    console.log(`\n  Checking ${allWAEvents.length} events against Firestore...`);
    const existingSnapshot = await db.collection("events").get();
    const existingIds = new Set(existingSnapshot.docs.map((doc) => doc.id));
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
        const startDate = event.StartDate ? String(event.StartDate).split("T")[0] : "";
        const endDate = event.EndDate ? String(event.EndDate).split("T")[0] : startDate;
        batch.set(db.collection("events").doc(eventId), {
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
        batchCount++;
        added++;
        if (batchCount === 450) {
            await batch.commit();
            batch = db.batch();
            batchCount = 0;
        }
    }
    if (batchCount > 0)
        await batch.commit();
    console.log(`✓ Events: ${added} added, ${skipped} skipped (already exist)`);
}
// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
    if (!WA_API_KEY || !WA_ACCOUNT_ID) {
        console.error("Missing WILD_APRICOT_API_KEY or WILD_APRICOT_ACCOUNT_ID in functions/.env");
        process.exit(1);
    }
    const target = process.argv[2]; // "members" | "events" | undefined
    const { from, limit } = parseArgs();
    if (from > 0 || limit < Infinity) {
        console.log(`Flags: --from ${from}${limit < Infinity ? ` --limit ${limit}` : ""}`);
    }
    try {
        if (!target || target === "members")
            await runSyncMembers(from, limit);
        if (!target || target === "events")
            await runSyncEvents();
        console.log("\nDone.");
    }
    catch (err) {
        console.error("Sync failed:", err);
        process.exit(1);
    }
}
main();
//# sourceMappingURL=run-sync.js.map