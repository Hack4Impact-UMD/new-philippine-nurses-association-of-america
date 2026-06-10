// Wild Apricot utilities shared by the sync-members script and (logic mirrored
// in supabase/functions/_shared/wa.ts for Deno Edge Functions).

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

export function chapterSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// ---------- Chapter resolution ----------
//
// WA reports chapter NAMES; Supabase stores chapter IDs. A ChapterResolver
// holds an in-memory snapshot of chapters + aliases and translates names
// into canonical ids, creating new chapters on the fly when WA introduces
// one we haven't seen.

export interface ChapterRow {
  id: string;
  name: string;
  region: string | null;
}

export interface ChapterAliasRow {
  aliasName: string;
  chapterId: string;
}

export class ChapterResolver {
  /** id → ChapterRow */
  private byId = new Map<string, ChapterRow>();
  /** lowercased name OR alias → id */
  private byName = new Map<string, string>();
  /** Pending creates flushed by `pendingChapters()`. */
  private pending = new Map<string, ChapterRow>();

  constructor(chapters: ChapterRow[], aliases: ChapterAliasRow[]) {
    for (const c of chapters) {
      this.byId.set(c.id, c);
      if (c.name) this.byName.set(c.name.toLowerCase(), c.id);
    }
    for (const a of aliases) {
      if (a.aliasName && a.chapterId) {
        this.byName.set(a.aliasName.toLowerCase(), a.chapterId);
      }
    }
  }

  /**
   * Translate a free-form chapter name (from WA) to a chapter id. Returns
   * null if `name` is empty. Creates a new chapter (queued in pending) if
   * the name doesn't match any known chapter or alias.
   */
  resolve(name: string, fallbackRegion: string = ""): string | null {
    const trimmed = (name ?? "").trim();
    if (!trimmed) return null;
    const key = trimmed.toLowerCase();
    const existing = this.byName.get(key);
    if (existing) return existing;
    const id = chapterSlug(trimmed);
    if (!id) return null;

    const existingById = this.byId.get(id);
    if (existingById) {
      // Row exists but its name wasn't in byName — back-fill the name/region
      // so the next chapter upsert restores them.
      if (!existingById.name || (!existingById.region && fallbackRegion)) {
        const patched: ChapterRow = {
          id,
          name: existingById.name || trimmed,
          region: existingById.region || fallbackRegion || null,
        };
        this.byId.set(id, patched);
        this.pending.set(id, patched);
      }
    } else if (!this.pending.has(id)) {
      this.pending.set(id, { id, name: trimmed, region: fallbackRegion || null });
      this.byId.set(id, { id, name: trimmed, region: fallbackRegion || null });
    }
    this.byName.set(key, id);
    return id;
  }

  /** Look up a chapter by id (returns null if unknown). */
  get(id: string | null | undefined): ChapterRow | null {
    if (!id) return null;
    return this.byId.get(id) ?? null;
  }

  /** Chapters newly created during resolve(); upsert these before referencing them. */
  pendingChapters(): ChapterRow[] {
    return [...this.pending.values()];
  }

  /** Convert a chapter id back to its display name (chapters table). */
  nameFor(id: string | null | undefined): string {
    return id ? (this.byId.get(id)?.name ?? "") : "";
  }
}

// ---------- Member mapping ----------

/**
 * Single JS-side definition of Active vs Lapsed. Must stay in semantic parity
 * with the SQL `public.is_renewal_active()` (migration 20260517000001), which
 * the pg_cron nightly job and chapter-aggregate RPC use: a date-only string
 * parses to midnight UTC in both `new Date()` and `::timestamptz` (DB is UTC),
 * and the member counts as Active through that instant.
 */
export function isRenewalActive(
  renewalDueDate: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!renewalDueDate) return false;
  const due = new Date(renewalDueDate);
  return !Number.isNaN(due.getTime()) && due >= now;
}

export type MemberData = {
  id: string;
  contactId: string;
  name: string;
  email: string;
  membershipLevel: string;
  renewalDueDate: string;
  chapterId: string | null;
  highestEducation: string;
  memberId: string;
  region: string;
  activeStatus: "Active" | "Lapsed";
  lastSynced: string;
};

/**
 * Map a WA contact to a MemberData row. The resolver handles chapter name → id
 * translation (and queues chapter creates internally for later upsert).
 */
export function mapContactToMember(
  contact: Record<string, unknown>,
  resolver: ChapterResolver
): MemberData | null {
  const fieldValues =
    (contact.FieldValues as Array<{ FieldName: string; Value: unknown }>) || [];
  const isArchived = fieldValues.find((f) => f.FieldName === "Archived")?.Value === true;
  if (isArchived) return null;

  const now = new Date();
  const renewalDueDate = extractFieldValue(fieldValues, "Renewal due");
  const activeStatus: "Active" | "Lapsed" = isRenewalActive(renewalDueDate, now)
    ? "Active"
    : "Lapsed";
  const memberId = extractFieldValue(fieldValues, "Member ID") || String(contact.Id);
  const membershipLevel =
    contact.MembershipLevel &&
    typeof contact.MembershipLevel === "object" &&
    "Name" in (contact.MembershipLevel as Record<string, unknown>)
      ? String((contact.MembershipLevel as { Name: unknown }).Name)
      : "";

  // Member-at-Large gets pinned to a pseudo-chapter.
  let chapterName = extractChapterName(fieldValues);
  if (!chapterName && membershipLevel === "Member-at-Large (1 year)") {
    chapterName = "PNA Member-at-Large";
  }
  const region = extractFieldValue(fieldValues, "PNAA Region");
  const chapterId = resolver.resolve(chapterName, chapterName === "PNA Member-at-Large" ? "" : region);
  const contactId = String(contact.Id ?? "");
  if (!contactId) return null;

  // (#14) members.id is always the WA contact id; attendees.memberId joins
  // against it. The "Member ID" field is preserved as a display column.
  return {
    id: contactId,
    contactId,
    name: `${contact.FirstName ?? ""} ${contact.LastName ?? ""}`.trim(),
    email: String(contact.Email ?? ""),
    membershipLevel,
    renewalDueDate,
    chapterId,
    highestEducation: extractFieldValue(fieldValues, "Highest Level of Education"),
    memberId,
    region,
    activeStatus,
    lastSynced: new Date().toISOString(),
  };
}
