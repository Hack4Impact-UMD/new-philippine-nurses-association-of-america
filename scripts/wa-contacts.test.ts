import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Retries back off for seconds; make them instant.
vi.mock("node:timers/promises", () => ({ setTimeout: vi.fn(() => Promise.resolve()) }));

import { fetchAllWAContacts } from "./wa-contacts.js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const contacts = (from: number, n: number) =>
  Array.from({ length: n }, (_, i) => ({ Id: from + i }));

/** Answers the count request with `count`, then serves `pages` in order. */
function stubWA(count: number, pages: Array<Response | (() => Response)>) {
  const queue = [...pages];
  const fetchMock = vi.fn(async (url: string | URL, _init?: RequestInit) => {
    if (String(url).includes("$count=true")) return json({ Count: count });
    const next = queue.shift();
    if (!next) throw new Error(`unexpected request ${url}`);
    return typeof next === "function" ? next() : next;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const silent = () => {};

describe("fetchAllWAContacts", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("pages until a short page and sends the token", async () => {
    const fetchMock = stubWA(150, [json({ Contacts: contacts(0, 100) }), json({ Contacts: contacts(100, 50) })]);
    const result = await fetchAllWAContacts("tok", "acct", silent);
    expect(result).toHaveLength(150);

    const pageUrls = fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("$top"));
    expect(pageUrls[0]).toContain("/accounts/acct/contacts");
    expect(pageUrls[0]).toContain("$skip=0");
    expect(pageUrls[1]).toContain("$skip=100");
    const init = fetchMock.mock.calls[0][1]!;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("drops contacts a live list returned twice", async () => {
    stubWA(100, [json({ Contacts: contacts(0, 100) }), json({ Contacts: contacts(99, 1) })]);
    const result = await fetchAllWAContacts("tok", "acct", silent);
    expect(result).toHaveLength(100);
    expect(new Set(result.map((c) => c.Id)).size).toBe(100);
  });

  it("refuses a fetch that came back well short of the count", async () => {
    stubWA(300, [json({ Contacts: contacts(0, 50) })]);
    await expect(fetchAllWAContacts("tok", "acct", silent)).rejects.toThrow(
      "WA contacts fetch incomplete: got 50, expected 300"
    );
  });

  it("retries a 503 page and carries on", async () => {
    const fetchMock = stubWA(10, [
      () => new Response("", { status: 503 }),
      json({ Contacts: contacts(0, 10) }),
    ]);
    const result = await fetchAllWAContacts("tok", "acct", silent);
    expect(result).toHaveLength(10);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws, rather than returning a partial list, when a page keeps failing", async () => {
    stubWA(10, Array.from({ length: 4 }, () => () => new Response("", { status: 500, statusText: "Server Error" })));
    await expect(fetchAllWAContacts("tok", "acct", silent)).rejects.toThrow(
      "WA contacts page failed at skip=0"
    );
  });
});
