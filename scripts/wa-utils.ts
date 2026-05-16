// Wild Apricot utilities shared by the sync-members script and (logic mirrored
// in supabase/functions/_shared for Deno Edge Functions).

export function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function getWAToken(): Promise<string> {
  const apiKey = getEnv("WILD_APRICOT_API_KEY");
  const credentials = Buffer.from(`APIKEY:${apiKey}`).toString("base64");
  const response = await fetch("https://oauth.wildapricot.org/auth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=auto",
  });
  if (!response.ok) throw new Error(`WA auth failed: ${response.statusText}`);
  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

export function getWAAccountId(): string {
  return getEnv("WILD_APRICOT_ACCOUNT_ID");
}

export function extractFieldValue(
  fieldValues: Array<{ FieldName: string; Value: unknown }>,
  fieldName: string
): string {
  const field = fieldValues.find((f) => f.FieldName === fieldName);
  if (!field || field.Value == null) return "";
  if (typeof field.Value === "object" && "Label" in (field.Value as Record<string, unknown>)) {
    return String((field.Value as { Label: string }).Label ?? "");
  }
  return String(field.Value);
}

export function extractChapterName(
  fieldValues: Array<{ FieldName: string; Value: unknown }>
): string {
  const chapterFields = fieldValues.filter((f) => f.FieldName.includes("Chapter"));
  for (const field of chapterFields) {
    if (field.Value == null) continue;
    let value: string;
    if (typeof field.Value === "object" && "Label" in (field.Value as Record<string, unknown>)) {
      value = String((field.Value as { Label: string }).Label ?? "");
    } else {
      value = String(field.Value);
    }
    if (value) return value;
  }
  return "";
}

export type MemberData = {
  id: string;
  name: string;
  email: string;
  membershipLevel: string;
  renewalDueDate: string;
  chapterName: string;
  highestEducation: string;
  memberId: string;
  region: string;
  activeStatus: "Active" | "Lapsed";
  lastSynced: string;
};

export function mapContactToMember(contact: Record<string, unknown>): MemberData | null {
  const fieldValues =
    (contact.FieldValues as Array<{ FieldName: string; Value: unknown }>) || [];
  const isArchived = fieldValues.find((f) => f.FieldName === "Archived")?.Value === true;
  if (isArchived) return null;

  const now = new Date();
  const renewalDueDate = extractFieldValue(fieldValues, "Renewal due");
  const activeStatus: "Active" | "Lapsed" =
    renewalDueDate && new Date(renewalDueDate) >= now ? "Active" : "Lapsed";
  const memberId = extractFieldValue(fieldValues, "Member ID") || String(contact.Id);
  const membershipLevel =
    contact.MembershipLevel &&
    typeof contact.MembershipLevel === "object" &&
    "Name" in (contact.MembershipLevel as Record<string, unknown>)
      ? String((contact.MembershipLevel as { Name: unknown }).Name)
      : "";

  return {
    id: memberId,
    name: `${contact.FirstName ?? ""} ${contact.LastName ?? ""}`.trim(),
    email: String(contact.Email ?? ""),
    membershipLevel,
    renewalDueDate,
    chapterName: extractChapterName(fieldValues),
    highestEducation: extractFieldValue(fieldValues, "Highest Level of Education"),
    memberId,
    region: extractFieldValue(fieldValues, "PNAA Region"),
    activeStatus,
    lastSynced: new Date().toISOString(),
  };
}

export function chapterSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
