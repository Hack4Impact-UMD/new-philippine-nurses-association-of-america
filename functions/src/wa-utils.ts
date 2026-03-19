/**
 * Shared Wild Apricot utilities used by scheduled sync functions and the webhook handler.
 */

import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { defineString } from "firebase-functions/params";

const WA_API_KEY = defineString("WILD_APRICOT_API_KEY");
const WA_ACCOUNT_ID = defineString("WILD_APRICOT_ACCOUNT_ID");

export function getWAAccountId(): string {
  return WA_ACCOUNT_ID.value();
}

export async function getWAToken(): Promise<string> {
  const credentials = Buffer.from(`APIKEY:${WA_API_KEY.value()}`).toString("base64");
  const response = await fetch("https://oauth.wildapricot.org/auth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=auto",
  });
  if (!response.ok) throw new Error(`WA auth failed: ${response.statusText}`);
  const data = await response.json();
  return data.access_token;
}

export function extractFieldValue(
  fieldValues: Array<{ FieldName: string; Value: unknown }>,
  fieldName: string
): string {
  const field = fieldValues.find((f) => f.FieldName === fieldName);
  if (!field || field.Value === null || field.Value === undefined) return "";
  if (
    typeof field.Value === "object" &&
    field.Value !== null &&
    "Label" in (field.Value as Record<string, unknown>)
  ) {
    return (field.Value as { Label: string }).Label;
  }
  return String(field.Value);
}

export function extractChapterName(
  fieldValues: Array<{ FieldName: string; Value: unknown }>
): string {
  const chapterFields = fieldValues.filter((f) => f.FieldName.includes("Chapter"));
  for (const field of chapterFields) {
    if (field.Value === null || field.Value === undefined) continue;
    let value: string;
    if (
      typeof field.Value === "object" &&
      "Label" in (field.Value as Record<string, unknown>)
    ) {
      value = (field.Value as { Label: string }).Label;
    } else {
      value = String(field.Value);
    }
    if (value) return value;
  }
  return "";
}

export type MemberData = {
  name: string;
  email: string;
  membershipLevel: string;
  renewalDueDate: string;
  chapterName: string;
  highestEducation: string;
  memberId: string;
  region: string;
  activeStatus: "Active" | "Lapsed";
  lastSynced: Timestamp;
};

/** Maps a raw WA contact object to MemberData. Returns null for archived contacts. */
export function mapContactToMember(
  contact: Record<string, unknown>
): MemberData | null {
  const fieldValues =
    (contact.FieldValues as Array<{ FieldName: string; Value: unknown }>) || [];

  const isArchived =
    fieldValues.find((f) => f.FieldName === "Archived")?.Value === true;
  if (isArchived) return null;

  const now = new Date();
  const renewalDueDate = extractFieldValue(fieldValues, "Renewal due");
  const activeStatus: "Active" | "Lapsed" =
    renewalDueDate && new Date(renewalDueDate) >= now ? "Active" : "Lapsed";

  const memberId =
    extractFieldValue(fieldValues, "Member ID") || String(contact.Id);

  const membershipLevel =
    contact.MembershipLevel &&
    typeof contact.MembershipLevel === "object" &&
    "Name" in (contact.MembershipLevel as Record<string, unknown>)
      ? String((contact.MembershipLevel as { Name: unknown }).Name)
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
    lastSynced: Timestamp.now(),
  };
}

/** Fetches a single WA contact by their WA contact ID. Returns null if not found. */
export async function fetchWAContact(
  accessToken: string,
  accountId: string,
  contactId: string | number
): Promise<Record<string, unknown> | null> {
  const url = `https://api.wildapricot.org/v2/accounts/${accountId}/contacts/${contactId}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`WA contact fetch failed (${contactId}): ${response.statusText}`);
  }
  return response.json() as Promise<Record<string, unknown>>;
}

/** Fetches a single WA event by its event ID. Returns null if not found. */
export async function fetchWAEvent(
  accessToken: string,
  accountId: string,
  eventId: string | number
): Promise<Record<string, unknown> | null> {
  const url = `https://api.wildapricot.org/v2/accounts/${accountId}/events/${eventId}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`WA event fetch failed (${eventId}): ${response.statusText}`);
  }
  return response.json() as Promise<Record<string, unknown>>;
}

/** Converts a chapter name to its Firestore document slug. */
export function chapterSlug(chapterName: string): string {
  return chapterName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * Recalculates chapter aggregates for the given chapter names by re-querying
 * Firestore members. Used by the webhook handler for targeted per-contact updates.
 */
export async function recalculateChapterAggregates(
  chapterNames: string[]
): Promise<void> {
  const db = getFirestore();
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
      } else {
        totalLapsed++;
      }
      if (!region && m.region) region = m.region as string;
    }

    const slug = chapterSlug(chapterName);
    const chapterRef = db.collection("chapters").doc(slug);
    batch.set(
      chapterRef,
      {
        name: chapterName,
        region,
        totalMembers,
        totalActive,
        totalLapsed,
        lastUpdated: Timestamp.now(),
      },
      { merge: true }
    );
  }

  await batch.commit();
}
