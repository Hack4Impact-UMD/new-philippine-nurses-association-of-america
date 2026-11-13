// Paginated Wild Apricot contact fetch, shared by sync-members.ts and
// backfill-member-joins.ts.

import { setTimeout as sleep } from "node:timers/promises";

// One sync is ~160 WA requests, so retry 429 / 5xx / network errors with
// backoff (1s, 2s, 4s, or Retry-After). The final attempt's response or error
// goes to the caller.
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = 3,
  log: (msg: string) => void = console.log
): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    let delay = 1000 * 2 ** (attempt - 1);
    try {
      const r = await fetch(url, init);
      if (r.status !== 429 && r.status < 500) return r;
      const retryAfter = Number(r.headers.get("Retry-After"));
      if (retryAfter > 0) delay = Math.min(retryAfter, 60) * 1000;
      log(`WA ${r.status}, retry ${attempt}/${retries} in ${delay}ms`);
    } catch {
      log(`WA network error, retry ${attempt}/${retries} in ${delay}ms`);
    }
    await sleep(delay);
  }
  return fetch(url, init);
}

export async function fetchAllWAContacts(
  accessToken: string,
  accountId: string,
  log: (msg: string) => void = console.log
): Promise<Record<string, unknown>[]> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };

  const baseUrl = `https://api.wildapricot.org/v2/accounts/${accountId}/contacts?$async=false&$filter=Archived%20eq%20false`;

  // Expected total, checked after paging: a short page ends the loop, so a
  // page cut short mid-list would otherwise look like the last one.
  const countResponse = await fetchWithRetry(`${baseUrl}&$count=true`, { headers }, 3, log);
  if (!countResponse.ok) {
    throw new Error(`WA contacts count failed: ${countResponse.statusText}`);
  }
  const expectedCount = ((await countResponse.json()) as { Count?: number }).Count;
  if (typeof expectedCount !== "number") {
    throw new Error("WA contacts count response had no Count");
  }
  log(`${expectedCount} total contacts`);

  const PAGE_SIZE = 100;
  const allContacts: Record<string, unknown>[] = [];
  let skip = 0;

  while (true) {
    const pageUrl = `${baseUrl}&$top=${PAGE_SIZE}&$skip=${skip}`;
    const r = await fetchWithRetry(pageUrl, { headers }, 3, log);
    if (!r.ok) {
      // Throw rather than break: a partial snapshot would, in sync-members,
      // zero out chapter aggregates for chapters whose members didn't make it
      // into this run and still log the sync as "complete".
      throw new Error(`WA contacts page failed at skip=${skip}: ${r.statusText}`);
    }
    log(`fetched contacts page at skip=${skip}`);
    const pageData = (await r.json()) as Record<string, unknown>;
    const contacts = (pageData.Contacts as Record<string, unknown>[]) || [];
    if (contacts.length === 0) break;
    allContacts.push(...contacts);
    skip += contacts.length;
    if (contacts.length < PAGE_SIZE) break;
  }

  // Paging a live list can return a contact twice, and a repeated id in one
  // upsert chunk makes Postgres reject the chunk. Dedupe before the count
  // check so duplicates can't mask missing contacts.
  const uniqueContacts = [...new Map(allContacts.map((c) => [String(c.Id), c])).values()];
  if (uniqueContacts.length < allContacts.length) {
    log(`dropped ${allContacts.length - uniqueContacts.length} duplicate contacts`);
  }

  // Allow 1% drift for contacts added or archived during the run.
  const COUNT_TOLERANCE = Math.ceil(expectedCount * 0.01);
  if (Math.abs(uniqueContacts.length - expectedCount) > COUNT_TOLERANCE) {
    throw new Error(
      `WA contacts fetch incomplete: got ${uniqueContacts.length}, expected ${expectedCount} (±${COUNT_TOLERANCE})`
    );
  }

  return uniqueContacts;
}
