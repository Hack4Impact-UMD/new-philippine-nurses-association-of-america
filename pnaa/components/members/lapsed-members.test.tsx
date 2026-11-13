import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LapsedMemberRow } from "@/types/membership-event";

// ---- mocks: only the edges (network, auth, router); the component, the table
// and the bucketing all run for real.

const rpc = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowser: () => ({ rpc }),
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

import { LapsedMembers } from "./lapsed-members";

function row(name: string, daysLapsed: number): LapsedMemberRow {
  return {
    memberId: `id-${name}`,
    name,
    email: `${name.toLowerCase()}@example.com`,
    membershipLevel: "Regular Member",
    chapterId: "garden-state",
    chapterName: "Garden State",
    region: "Northeast Region",
    lapsedOn: "2026-01-01",
    daysLapsed,
  };
}

const ROWS = [
  row("Ana", 3),
  row("Ben", 30),
  row("Cora", 31),
  row("Dino", 75),
  row("Ely", 91),
  row("Fe", 400),
];

/** Names of the members in the table body, top to bottom. */
function tableNames(): string[] {
  const table = screen.getByRole("table");
  const names = new RegExp(`^(${ROWS.map((r) => r.name).join("|")})$`);
  return within(table)
    .queryAllByText(names)
    .map((el) => el.textContent ?? "");
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

beforeEach(() => {
  rpc.mockReset();
  push.mockReset();
  auth.role = "national_admin";
});

describe("LapsedMembers", () => {
  it("asks the lapsed_members RPC for the caller's scope", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    render(<LapsedMembers />);
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("lapsed_members", {
        p_scope_type: "national",
        p_scope: null,
      })
    );
  });

  it("counts members into the 30 / 60 / 90 / 90+ day buttons", async () => {
    rpc.mockResolvedValue({ data: ROWS, error: null });
    render(<LapsedMembers />);

    const group = await screen.findByRole("group", { name: "Lapsed for" });
    await waitFor(() =>
      expect(within(group).getByRole("button", { name: /^All/ })).toHaveTextContent("All 6")
    );
    const text = within(group)
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(text).toEqual([
      "All 6",
      "≤30 days 2",
      "31–60 days 1",
      "61–90 days 1",
      "90+ days 2",
    ]);
  });

  it("shows every lapsed member by default, freshest first", async () => {
    rpc.mockResolvedValue({ data: ROWS, error: null });
    render(<LapsedMembers />);
    await screen.findByText("Ana");
    expect(tableNames()).toEqual(["Ana", "Ben", "Cora", "Dino", "Ely", "Fe"]);
  });

  it.each([
    ["≤30 days", ["Ana", "Ben"]],
    ["31–60 days", ["Cora"]],
    ["61–90 days", ["Dino"]],
    ["90+ days", ["Ely", "Fe"]],
  ])("filtering to %s shows only those members", async (label, expected) => {
    const user = userEvent.setup();
    rpc.mockResolvedValue({ data: ROWS, error: null });
    render(<LapsedMembers />);
    await screen.findByText("Ana");

    const button = screen.getByRole("button", { name: new RegExp(`^${escape(label)}`) });
    await user.click(button);

    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(tableNames()).toEqual(expected);
  });

  it("labels each row with its bucket and exact day count", async () => {
    rpc.mockResolvedValue({ data: [row("Dino", 75)], error: null });
    render(<LapsedMembers />);
    const name = await screen.findByText("Dino");
    const tr = name.closest("tr")!;
    expect(within(tr).getByText("61–90 days")).toBeInTheDocument();
    expect(within(tr).getByText("75d")).toBeInTheDocument();
  });

  it("says so when a bucket is empty", async () => {
    const user = userEvent.setup();
    rpc.mockResolvedValue({ data: [row("Ana", 3)], error: null });
    render(<LapsedMembers />);
    await screen.findByText("Ana");
    await user.click(screen.getByRole("button", { name: /^90\+ days/ }));
    expect(screen.getByText("No members lapsed 90+ days")).toBeInTheDocument();
    expect(screen.queryByText("Ana")).not.toBeInTheDocument();
  });

  it("opens the member when a row is clicked", async () => {
    const user = userEvent.setup();
    rpc.mockResolvedValue({ data: [row("Ana", 3)], error: null });
    render(<LapsedMembers />);
    await user.click(await screen.findByText("Ana"));
    expect(push).toHaveBeenCalledWith("/members/id-Ana");
  });

  it("shows the error instead of a table when the RPC fails", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "not permitted to view national data" },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<LapsedMembers />);
    expect(
      await screen.findByText(/not permitted to view national data/)
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders nothing and fetches nothing for a non-admin", () => {
    auth.role = "member";
    const { container } = render(<LapsedMembers />);
    expect(container).toBeEmptyDOMElement();
    expect(rpc).not.toHaveBeenCalled();
  });
});
