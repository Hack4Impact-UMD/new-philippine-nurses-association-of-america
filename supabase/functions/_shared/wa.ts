// Deno-flavored Wild Apricot helpers used by Edge Functions.

export function getWAAccountId(): string {
  const v = Deno.env.get("WILD_APRICOT_ACCOUNT_ID");
  if (!v) throw new Error("Missing WILD_APRICOT_ACCOUNT_ID");
  return v;
}

export async function getWAToken(): Promise<string> {
  const apiKey = Deno.env.get("WILD_APRICOT_API_KEY");
  if (!apiKey) throw new Error("Missing WILD_APRICOT_API_KEY");
  const credentials = btoa(`APIKEY:${apiKey}`);
  const r = await fetch("https://oauth.wildapricot.org/auth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=auto",
  });
  if (!r.ok) throw new Error(`WA auth failed: ${r.statusText}`);
  const data = await r.json();
  return data.access_token as string;
}

export function extractFieldValue(
  fieldValues: Array<{ FieldName: string; Value: unknown }>,
  fieldName: string,
): string {
  const f = fieldValues.find((x) => x.FieldName === fieldName);
  if (!f || f.Value == null) return "";
  if (typeof f.Value === "object" && "Label" in (f.Value as Record<string, unknown>)) {
    return String((f.Value as { Label: string }).Label ?? "");
  }
  return String(f.Value);
}

export function chapterSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function extractChapterName(
  fieldValues: Array<{ FieldName: string; Value: unknown }>,
): string {
  const fields = fieldValues.filter((f) => f.FieldName.includes("Chapter"));
  for (const f of fields) {
    if (f.Value == null) continue;
    if (typeof f.Value === "object" && "Label" in (f.Value as Record<string, unknown>)) {
      const v = String((f.Value as { Label: string }).Label ?? "");
      if (v) return v;
    } else {
      const v = String(f.Value);
      if (v) return v;
    }
  }
  return "";
}

// ---------- Chapter resolution (Deno) ----------
//
// Mirrors scripts/wa-utils.ts ChapterResolver. Used by the webhook + event sync
// to translate WA chapter names → chapter ids without per-call DB lookups.

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
  private byId = new Map<string, ChapterRow>();
  private byName = new Map<string, string>();
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
      // Back-fill missing name/region so the next chapter upsert restores them.
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

  get(id: string | null | undefined): ChapterRow | null {
    if (!id) return null;
    return this.byId.get(id) ?? null;
  }

  pendingChapters(): ChapterRow[] {
    return [...this.pending.values()];
  }
}

/** Loads chapters + aliases from Supabase and returns a ChapterResolver. */
export async function loadResolver(
  supabase: { from: (t: string) => { select: (cols: string) => Promise<{ data: unknown; error: unknown }> } },
): Promise<ChapterResolver> {
  const [chaptersR, aliasesR] = await Promise.all([
    supabase.from("chapters").select("id, name, region"),
    supabase.from("chapter_aliases").select("aliasName, chapterId"),
  ]);
  const chapters = (chaptersR.data as ChapterRow[] | null) ?? [];
  const aliases = (aliasesR.data as ChapterAliasRow[] | null) ?? [];
  return new ChapterResolver(chapters, aliases);
}

/** Flush any new chapters that resolve() created during the call. */
export async function flushPendingChapters(
  supabase: { from: (t: string) => { upsert: (rows: unknown[], opts: { onConflict: string }) => Promise<{ error: unknown }> } },
  resolver: ChapterResolver,
): Promise<void> {
  const pending = resolver.pendingChapters();
  if (pending.length === 0) return;
  const { error } = await supabase.from("chapters").upsert(
    pending.map((c) => ({ id: c.id, name: c.name, region: c.region })),
    { onConflict: "id" },
  );
  // Fail loudly: a swallowed error here leaves member/event inserts to fail
  // later with opaque FK violations against the chapters that never landed.
  if (error) throw error;
}

export async function fetchWAEvent(
  accessToken: string,
  accountId: string,
  eventId: string | number,
): Promise<Record<string, unknown> | null> {
  const url = `https://api.wildapricot.org/v2/accounts/${accountId}/events/${eventId}`;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (!r.ok) {
    if (r.status === 404) return null;
    throw new Error(`WA event fetch failed (${eventId}): ${r.statusText}`);
  }
  return await r.json();
}

export type WARegistration = {
  registrationId: string;
  eventId: string;
  contactId: string;
  name: string;
  registrationTypeId: string;
  registrationType: string;
  organization: string;
  isPaid: boolean;
  registrationFee: number;
  paidSum: number;
  OnWaitlist: boolean;
  Status: string;
};

export async function fetchWAEventRegistrations(
  accessToken: string,
  accountId: string,
  eventId: string | number,
): Promise<WARegistration[]> {
  const PAGE = 100;
  let skip = 0;
  const out: WARegistration[] = [];
  while (true) {
    const url =
      `https://api.wildapricot.org/v2.1/Accounts/${accountId}/eventregistrations` +
      `?eventId=${eventId}&$top=${PAGE}&$skip=${skip}`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!r.ok) {
      if (r.status === 404) return [];
      throw new Error(`WA registrations fetch failed (event ${eventId}): ${r.statusText}`);
    }
    const data = await r.json();
    const page: Record<string, unknown>[] = Array.isArray(data) ? data : (data.Registrations ?? []);
    for (const reg of page) {
      const contact = (reg.Contact ?? {}) as Record<string, unknown>;
      const regType = (reg.RegistrationType ?? {}) as Record<string, unknown>;
      const ev = (reg.Event ?? {}) as Record<string, unknown>;
      out.push({
        registrationId: String(reg.Id ?? ""),
        eventId: String(ev.Id ?? eventId),
        contactId: String(contact.Id ?? ""),
        name: String(contact.Name ?? ""),
        registrationTypeId: String(regType.Id ?? ""),
        registrationType: String(regType.Name ?? ""),
        organization: String(reg.Organization ?? ""),
        isPaid: Boolean(reg.IsPaid ?? false),
        registrationFee: Number(reg.RegistrationFee ?? 0),
        paidSum: Number(reg.PaidSum ?? 0),
        OnWaitlist: Boolean(reg.OnWaitlist ?? false),
        Status: String(reg.Status ?? ""),
      });
    }
    skip += page.length;
    if (page.length < PAGE) break;
  }
  return out;
}

export async function fetchWARegistration(
  accessToken: string,
  accountId: string,
  registrationId: string | number,
): Promise<WARegistration | null> {
  const url =
    `https://api.wildapricot.org/v2.1/Accounts/${accountId}/eventregistrations/${registrationId}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!r.ok) {
    if (r.status === 404) return null;
    throw new Error(`WA registration fetch failed (${registrationId}): ${r.statusText}`);
  }
  const reg = await r.json();
  const contact = (reg.Contact ?? {}) as Record<string, unknown>;
  const regType = (reg.RegistrationType ?? {}) as Record<string, unknown>;
  const ev = (reg.Event ?? {}) as Record<string, unknown>;
  return {
    registrationId: String(reg.Id ?? ""),
    eventId: String(ev.Id ?? ""),
    contactId: String(contact.Id ?? ""),
    name: String(reg.DisplayName ?? contact.Name ?? ""),
    registrationTypeId: String(regType.Id ?? ""),
    registrationType: String(regType.Name ?? ""),
    organization: String(reg.Organization ?? ""),
    isPaid: Boolean(reg.IsPaid ?? false),
    registrationFee: Number(reg.RegistrationFee ?? 0),
    paidSum: Number(reg.PaidSum ?? 0),
    OnWaitlist: Boolean(reg.OnWaitlist ?? false),
    Status: String(reg.Status ?? ""),
  };
}

export async function fetchWAContact(
  accessToken: string,
  accountId: string,
  contactId: string | number,
): Promise<Record<string, unknown> | null> {
  const url = `https://api.wildapricot.org/v2/accounts/${accountId}/contacts/${contactId}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!r.ok) {
    if (r.status === 404) return null;
    throw new Error(`WA contact fetch failed (${contactId}): ${r.statusText}`);
  }
  return await r.json();
}
