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

// Radix popovers and selects measure and capture pointers, which jsdom lacks.
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

/** Open the month range picker. */
async function openPicker(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /^Months:/ }));
  return screen.findByRole("group", { name: /^Months of/ });
}

/** The picker's min month arrives after mount; wait for it to reach `year`. */
async function waitForYear(user: ReturnType<typeof userEvent.setup>, year: string) {
  await waitFor(async () => {
    if (!screen.queryByRole("group", { name: /^Months of/ })) await openPicker(user);
    if (!screen.queryByRole("group", { name: "Years" })) {
      await user.click(screen.getByRole("button", { name: /Choose year/ }));
    }
    expect(screen.getByRole("button", { name: year })).toBeInTheDocument();
  });
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
    expect(screen.getByRole("button", { name: /^Months:/ })).toHaveTextContent(
      "November 2026"
    );
  });

  it("lets the picker reach back to the oldest backfilled join", async () => {
    const user = userEvent.setup();
    firstRecorded = "1985-04-01";
    render(<NewRenewedMembers />);
    await waitFor(() => expect(firstRecordedQuery).toHaveBeenCalledWith("membership_events"));

    await waitForYear(user, "1985");
    const years = within(screen.getByRole("group", { name: "Years" }))
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(years).toHaveLength(2026 - 1985 + 1);

    await user.click(screen.getByRole("button", { name: "1985" }));
    expect(screen.getByRole("button", { name: "March 1985" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "April 1985" })).toBeEnabled();
  });

  it("offers only this month before anything has been recorded", async () => {
    const user = userEvent.setup();
    render(<NewRenewedMembers />);
    await waitFor(() => expect(firstRecordedQuery).toHaveBeenCalled());
    const months = await openPicker(user);
    const enabled = within(months)
      .getAllByRole("button")
      .filter((b) => !b.hasAttribute("disabled"))
      .map((b) => b.getAttribute("aria-label"));
    expect(enabled).toEqual(["November 2026"]);
    expect(screen.getByRole("button", { name: "Previous year" })).toBeDisabled();
  });

  it("fetches all time, decades of months, in a single request", async () => {
    const user = userEvent.setup();
    firstRecorded = "1985-04-01";
    render(<NewRenewedMembers />);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    await waitForYear(user, "1985");

    await user.click(screen.getByRole("button", { name: "All time" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    expect(rpc).toHaveBeenLastCalledWith("member_joins_and_renewals", {
      p_month: "1985-04-01",
      p_to_month: "2026-11-01",
      p_scope_type: "national",
      p_scope: null,
    });
    expect(screen.getByRole("button", { name: /^Months:/ })).toHaveTextContent(
      "Apr 1985 – Nov 2026"
    );
  });

  it("orders a range picked end-first", async () => {
    const user = userEvent.setup();
    firstRecorded = "1998-01-01";
    render(<NewRenewedMembers />);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    await waitForYear(user, "1998");
    await user.click(screen.getByRole("button", { name: "1998" }));

    await user.click(screen.getByRole("button", { name: "December 1998" }));
    await user.click(screen.getByRole("button", { name: "July 1998" }));

    await waitFor(() =>
      expect(rpc).toHaveBeenLastCalledWith(
        "member_joins_and_renewals",
        expect.objectContaining({ p_month: "1998-07-01", p_to_month: "1998-12-01" })
      )
    );
    expect(screen.getByText(/No new or renewed members for Jul – Dec 1998/)).toBeInTheDocument();
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
