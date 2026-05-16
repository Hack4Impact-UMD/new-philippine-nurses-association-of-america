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
