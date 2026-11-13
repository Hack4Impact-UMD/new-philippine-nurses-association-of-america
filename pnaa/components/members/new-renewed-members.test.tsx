// Pacific time, so a backfilled join stored at noon UTC is shown in a zone
// where midnight UTC would already be the previous day. Node re-reads TZ when
// it is assigned, so this must run before any date is formatted.
process.env.TZ = "America/Los_Angeles";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MembershipEventRow } from "@/types/membership-event";

// ---- mocks: only the edges (network, auth, router). The component, its
// selects, and the data table all run for real.

const rpc = vi.fn();
/** What the "first recorded month" query returns. */
let firstRecorded: string | null = null;
const firstRecordedQuery = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowser: () => ({
    rpc,
    from: (table: string) => {
      const chain = {
        select: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => {
          firstRecordedQuery(table);
          return {
            data: firstRecorded ? { eventMonth: firstRecorded } : null,
            error: null,
          };
        },
      };
      return chain;
    },
  }),
}));

const auth = { role: "national_admin" as string };
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ isLoading: false }),
  useIsAdmin: () =>
    ["national_admin", "region_admin", "chapter_admin"].includes(auth.role),
  useIsNationalAdmin: () => auth.role === "national_admin",
  useIsRegionAdmin: () => auth.role === "region_admin",
  useUserChapter: () => undefined,
  useUserRegion: () => undefined,
}));

vi.mock("@/hooks/use-chapters-map", () => ({
  useChaptersMap: () => ({
    nameFor: (_id: string | null, fallback = "") => fallback,
    all: [],
    canonical: [],
    byId: new Map(),
    byName: new Map(),
  }),
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

import { NewRenewedMembers } from "./new-renewed-members";

// Radix Select measures and captures pointers, which jsdom lacks.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

function event(
  name: string,
  kind: MembershipEventRow["kind"],
  occurredAt: string
): MembershipEventRow {
  return {
    memberId: `id-${name}`,
    name,
    email: `${name.toLowerCase()}@example.com`,
    membershipLevel: "Regular Member (1 year)",
    chapterId: "garden-state",
    chapterName: "Garden State",
    region: "Northeast Region",
    kind,
    occurredAt,
  };
}

/** Open a month select and return the labels it offers, top to bottom. */
async function openMonthSelect(user: ReturnType<typeof userEvent.setup>, which: "From" | "To") {
  await user.click(screen.getByRole("combobox", { name: `${which} month` }));
  const listbox = await screen.findByRole("listbox");
  return within(listbox)
    .getAllByRole("option")
    .map((o) => o.textContent ?? "");
}

beforeEach(() => {
  // Fake only the clock, so "this month" is fixed but promises and user
  // events still run on real timers.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-13T15:00:00-05:00"));
  rpc.mockReset();
  rpc.mockResolvedValue({ data: [], error: null });
  firstRecordedQuery.mockReset();
  push.mockReset();
  firstRecorded = null;
  auth.role = "national_admin";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("NewRenewedMembers", () => {
  it("starts on this month, fetched in one call", async () => {
    render(<NewRenewedMembers />);
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("member_joins_and_renewals", {
      p_month: "2026-11-01",
      p_to_month: "2026-11-01",
      p_scope_type: "national",
      p_scope: null,
    });
    expect(screen.getByRole("combobox", { name: "From month" })).toHaveTextContent(
      "November 2026"
    );
  });

  it("offers every month back to the oldest backfilled join, not just ten years", async () => {
    const user = userEvent.setup();
    firstRecorded = "1985-04-01";
    render(<NewRenewedMembers />);
    await waitFor(() => expect(firstRecordedQuery).toHaveBeenCalledWith("membership_events"));

    await waitFor(async () => {
      // Re-open until the first-recorded month has arrived.
      const options = await openMonthSelect(user, "From");
      expect(options.at(-1)).toBe("April 1985");
    });
    const options = within(screen.getByRole("listbox"))
      .getAllByRole("option")
      .map((o) => o.textContent);
    // Nov 2026 back to Apr 1985 inclusive: 41 years and 8 months.
    expect(options).toHaveLength(41 * 12 + 8);
    expect(options[0]).toBe("November 2026");
    expect(options).toContain("January 2000");
    expect(options).not.toContain("March 1985");
  });

  it("offers only this month before anything has been recorded", async () => {
    const user = userEvent.setup();
    render(<NewRenewedMembers />);
    await waitFor(() => expect(firstRecordedQuery).toHaveBeenCalled());
    expect(await openMonthSelect(user, "To")).toEqual(["November 2026"]);
  });

  it("fetches a decades-long range in a single request", async () => {
    const user = userEvent.setup();
    firstRecorded = "1985-04-01";
    render(<NewRenewedMembers />);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));

    await waitFor(async () => {
      await openMonthSelect(user, "From");
      expect(screen.getByRole("option", { name: "April 1985" })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("option", { name: "April 1985" }));

    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    expect(rpc).toHaveBeenLastCalledWith("member_joins_and_renewals", {
      p_month: "1985-04-01",
      p_to_month: "2026-11-01",
      p_scope_type: "national",
      p_scope: null,
    });
  });

  it("reads a reversed range as the same range", async () => {
    const user = userEvent.setup();
    firstRecorded = "1998-01-01";
    render(<NewRenewedMembers />);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));

    await waitFor(async () => {
      await openMonthSelect(user, "To");
      expect(screen.getByRole("option", { name: "July 1998" })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("option", { name: "July 1998" }));

    await waitFor(() =>
      expect(rpc).toHaveBeenLastCalledWith(
        "member_joins_and_renewals",
        expect.objectContaining({ p_month: "1998-07-01", p_to_month: "2026-11-01" })
      )
    );
  });

  it("shows a backfilled join on its Wild Apricot start date", async () => {
    rpc.mockResolvedValue({
      data: [
        // Stored at noon UTC by backfill_member_joins().
        event("Lorna", "joined", "1998-07-04T12:00:00+00:00"),
        event("Mario", "renewed", "2026-11-02T14:30:00+00:00"),
      ],
      error: null,
    });
    render(<NewRenewedMembers />);

    const tr = (await screen.findByText("Lorna")).closest("tr")!;
    // Midnight UTC would have shown Jul 3 here in Pacific time.
    expect(within(tr).getByText("Jul 4, 1998")).toBeInTheDocument();
    expect(within(tr).getByText("New")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "All 2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Renewed 1" })).toBeInTheDocument();
  });

  it("filters to new members only", async () => {
    const user = userEvent.setup();
    rpc.mockResolvedValue({
      data: [
        event("Lorna", "joined", "1998-07-04T12:00:00+00:00"),
        event("Mario", "renewed", "2026-11-02T14:30:00+00:00"),
      ],
      error: null,
    });
    render(<NewRenewedMembers />);
    await screen.findByText("Mario");

    await user.click(screen.getByRole("button", { name: "New 1" }));
    expect(screen.getByText("Lorna")).toBeInTheDocument();
    expect(screen.queryByText("Mario")).not.toBeInTheDocument();
  });

  it("explains where join dates come from once history exists", async () => {
    firstRecorded = "1985-04-01";
    render(<NewRenewedMembers />);
    expect(
      await screen.findByText(/listed by their Wild Apricot start date/)
    ).toBeInTheDocument();
  });

  it("opens the member when a row is clicked", async () => {
    const user = userEvent.setup();
    rpc.mockResolvedValue({
      data: [event("Lorna", "joined", "1998-07-04T12:00:00+00:00")],
      error: null,
    });
    render(<NewRenewedMembers />);
    await user.click(await screen.findByText("Lorna"));
    expect(push).toHaveBeenCalledWith("/members/id-Lorna");
  });

  it("shows the error instead of a table when the RPC fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: { message: "not permitted to view national data" } });
    render(<NewRenewedMembers />);
    expect(await screen.findByText(/not permitted to view national data/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders nothing and fetches nothing for a non-admin", () => {
    auth.role = "member";
    const { container } = render(<NewRenewedMembers />);
    expect(container).toBeEmptyDOMElement();
    expect(rpc).not.toHaveBeenCalled();
    expect(firstRecordedQuery).not.toHaveBeenCalled();
  });
});
