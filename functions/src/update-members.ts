import { onSchedule } from "firebase-functions/v2/scheduler";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

export const updateMembers = onSchedule(
  { schedule: "every day 02:00", timeZone: "America/New_York" },
  async () => {
    const db = getFirestore();
    const now = new Date();

    // 1. Recalculate activeStatus for all members
    const membersSnapshot = await db.collection("members").get();
    const batch = db.batch();
    let statusChanges = 0;

    for (const doc of membersSnapshot.docs) {
      const member = doc.data();
      const renewalDueDate = member.renewalDueDate;

      let newStatus: "Active" | "Lapsed" = "Lapsed";
      if (renewalDueDate) {
        const dueDate = new Date(renewalDueDate);
        newStatus = dueDate >= now ? "Active" : "Lapsed";
      }

      if (member.activeStatus !== newStatus) {
        batch.update(doc.ref, { activeStatus: newStatus });
        statusChanges++;
      }
    }

    await batch.commit();
    console.log(`updateMembers: ${statusChanges} status changes`);

    // 2. Aggregate chapter counts
    const chapterCounts: Record<
      string,
      { totalMembers: number; totalActive: number; totalLapsed: number; region: string }
    > = {};

    for (const doc of membersSnapshot.docs) {
      const member = doc.data();
      const chapterName = member.chapterName;
      if (!chapterName) continue;

      if (!chapterCounts[chapterName]) {
        chapterCounts[chapterName] = {
          totalMembers: 0,
          totalActive: 0,
          totalLapsed: 0,
          region: member.region || "",
        };
      }

      chapterCounts[chapterName].totalMembers++;

      // Use the recalculated status
      const renewalDueDate = member.renewalDueDate;
      const isActive = renewalDueDate && new Date(renewalDueDate) >= now;
      if (isActive) {
        chapterCounts[chapterName].totalActive++;
      } else {
        chapterCounts[chapterName].totalLapsed++;
      }
    }

    // 3. Batch upsert chapter documents, zeroing out any that lost all members
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
      const slug = chapterName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");

      const chapterRef = db.collection("chapters").doc(slug);
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
    console.log(
      `updateMembers: updated ${Object.keys(chapterCounts).length} chapters`
    );
  }
);
