import { onRequest } from "firebase-functions/v2/https";
import { defineString } from "firebase-functions/params";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import {
  getWAToken,
  getWAAccountId,
  mapContactToMember,
  chapterSlug,
  MemberData,
} from "./wa-utils";

const WEBHOOK_SECRET = defineString("WEBHOOK_SECRET");

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * WA contacts API uses an async job system for large result sets.
 * 1. Make a request → WA returns a ResultUrl (job may be InProgress).
 * 2. Poll ResultUrl until State === "Complete".
 * 3. Paginate through the completed result using $top/$skip on the ResultUrl.
 */
async function fetchAllWAContacts(
  accessToken: string,
  accountId: string
): Promise<Record<string, unknown>[]> {
 const authHeaders = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };

  // Step 1: Initiate the contacts request
  const initUrl = `https://api.wildapricot.org/v2/accounts/${accountId}/contacts?$filter=Archived eq false`;
  const initResponse = await fetch(initUrl, { headers:  authHeaders });
  if (!initResponse.ok) {
    throw new Error(`WA contacts request failed: ${initResponse.statusText}`);
  }
  let data = (await initResponse.json()) as Record<string, unknown>;

  // Step 2: Poll until State === "Complete"
  // WA can take several minutes for large accounts; poll up to 8 minutes
  const resultUrl = data.ResultUrl as string | undefined;
  if (resultUrl && data.State !== "Complete") {
    console.log("syncMembers: waiting for WA contacts job...");
    for (let attempt = 0; attempt < 96; attempt++) {
      await sleep(5000);
      const pollResponse = await fetch(resultUrl, { headers:  authHeaders });
      if (!pollResponse.ok) {
        throw new Error(`WA contacts poll failed: ${pollResponse.statusText}`);
      }
      data = (await pollResponse.json()) as Record<string, unknown>;
      if (data.State === "Complete") {
        break;
      }
    }
    if (data.State !== "Complete") {
      throw new Error(
        `WA contacts async job timed out (last state: ${data.State})`
      );
    }
  }

  const totalCount = (data.ResultCount as number) || 0;
  console.log(`syncMembers: ${totalCount} total contacts`);

  // Step 3: Paginate through results using ResultUrl with $top/$skip
  const PAGE_SIZE = 100;
  const allContacts: Record<string, unknown>[] = [];
  let skip = 0;
  const baseUrl = resultUrl || initUrl;

  while (true) {
    const separator = baseUrl.includes("?") ? "&" : "?";
    const pageUrl = `${baseUrl}${separator}$skip=${skip}&$top=${PAGE_SIZE}`;
    
    const pageResponse = await fetch(pageUrl, { headers:  authHeaders });
    if (!pageResponse.ok) {
      console.error(
        `WA contacts page failed at skip=${skip}: ${pageResponse.statusText}`
      );
      break;
    }

    const pageData = (await pageResponse.json()) as Record<string, unknown>;
    const contacts = (pageData.Contacts as Record<string, unknown>[]) || [];
    const firstId = contacts[0] ? (contacts[0].Id as unknown) : undefined;
    const lastId =
      contacts[contacts.length - 1]
        ? (contacts[contacts.length - 1].Id as unknown)
        : undefined;
    if (contacts.length === 0) break;

    allContacts.push(...contacts);
    skip += contacts.length;

    if (contacts.length < PAGE_SIZE) break; // last page
  }

  return allContacts;
}

// HTTP endpoint for manually triggering a full member sync.
// Real-time updates are handled by the wildApricotWebhook function.
// Call with: POST /syncMembers?key=[WEBHOOK_SECRET]
export const syncMembers = onRequest(
  { timeoutSeconds: 720},
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
    const now = new Date();

    const rawContacts = await fetchAllWAContacts(accessToken, accountId);
    const allMembers: MemberData[] = [];

    for (const contact of rawContacts) {
      const member = mapContactToMember(contact);
      if (member) allMembers.push(member);
    }

    // Write all members to Firestore in batches of 450
    let batch = db.batch();
    let batchCount = 0;
    let processed = 0;

    for (const memberData of allMembers) {
      const docRef = db.collection("members").doc(memberData.memberId);
      
      //updates chapter name to Member-at-Large if the chapter name is blank/null
      // and the membership level is "Member-at-Large (1 year)"
      if ((memberData.chapterName == "" || memberData.chapterName == null)
         && memberData.membershipLevel == "Member-at-Large (1 year)") {
        memberData.chapterName = "PNA Member-at-Large";
      }
      
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
    const chapterCounts: Record<
      string,
      {
        totalMembers: number;
        totalActive: number;
        totalLapsed: number;
        region: string;
      }
    > = {};

    for (const member of allMembers) {
      if (!member.chapterName) continue;

      if (!chapterCounts[member.chapterName]) {
        chapterCounts[member.chapterName] = {
          totalMembers: 0,
          totalActive: 0,
          totalLapsed: 0,
          region: member.region,
        };
        if (member.chapterName == "PNA Member-at-Large") {
          chapterCounts[member.chapterName] = {... chapterCounts[member.chapterName], region: ""};
        }
      }

      chapterCounts[member.chapterName].totalMembers++;

      const isActive =
        member.renewalDueDate && new Date(member.renewalDueDate) >= now;
      if (isActive) {
        chapterCounts[member.chapterName].totalActive++;
      } else {
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
          lastUpdated: Timestamp.now(),
        });
      }
    }

    for (const [chapterName, counts] of Object.entries(chapterCounts)) {
      const chapterRef = db.collection("chapters").doc(chapterSlug(chapterName));
      chapterBatch.set(
        chapterRef,
        {
          name: chapterName,
          region: counts.region,
          totalMembers: counts.totalMembers,
          totalActive: counts.totalActive,
          totalLapsed: counts.totalLapsed,
          lastUpdated: Timestamp.now(),
        },
        { merge: true }
      );
    }

    await chapterBatch.commit();
    
    const msg =
      `syncMembers: processed ${processed} contacts, ` +
      `updated ${Object.keys(chapterCounts).length} chapters `;
    console.log(msg);
    res.status(200).send(msg);
  }
);
