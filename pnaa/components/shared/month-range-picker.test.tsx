import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MonthRangePicker, formatMonthRange } from "./month-range-picker";

function setup(props: Partial<Parameters<typeof MonthRangePicker>[0]> = {}) {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(
    <MonthRangePicker
      from="2026-11-01"
      to="2026-11-01"
      min="1985-04-01"
      max="2026-11-01"
      onChange={onChange}
      {...props}
    />
  );
  const open = () => user.click(screen.getByRole("button", { name: /^Months:/ }));
  const months = () => screen.getByRole("group", { name: /^Months of/ });
  return { onChange, user, open, months };
}

describe("formatMonthRange", () => {
  it.each([
    ["2026-11-01", "2026-11-01", "November 2026"],
    ["1998-03-01", "1998-08-01", "Mar – Aug 1998"],
    ["1998-03-01", "2026-11-01", "Mar 1998 – Nov 2026"],
  ])("%s to %s reads %s", (from, to, label) => {
    expect(formatMonthRange(from, to)).toBe(label);
  });
});

describe("MonthRangePicker", () => {
  it("shows the current range on its trigger", () => {
    setup({ from: "1998-03-01", to: "1998-08-01" });
    expect(screen.getByRole("button", { name: "Months: Mar – Aug 1998" })).toHaveTextContent(
      "Mar – Aug 1998"
    );
  });

  it("opens on the year of the range's end, with the range marked", async () => {
    const { open, months } = setup({ from: "1998-03-01", to: "1998-05-01" });
    await open();
    expect(months()).toHaveAccessibleName("Months of 1998");
    const pressed = within(months())
      .getAllByRole("button", { pressed: true })
      .map((b) => b.getAttribute("aria-label"));
    expect(pressed).toEqual(["March 1998", "April 1998", "May 1998"]);
  });

  it("selects a range with two clicks, in either order", async () => {
    const { open, user, onChange } = setup();
    await open();
    await user.click(screen.getByRole("button", { name: /Choose year/ }));
    await user.click(screen.getByRole("button", { name: "1998" }));
    await user.click(screen.getByRole("button", { name: "August 1998" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("From Aug 1998: pick the end month.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "March 1998" }));
    expect(onChange).toHaveBeenCalledWith("1998-03-01", "1998-08-01");
    // And it closes.
    expect(screen.queryByRole("group", { name: /^Months of/ })).not.toBeInTheDocument();
  });

  it("selects a single month by clicking it twice", async () => {
    const { open, user, onChange } = setup();
    await open();
    await user.click(screen.getByRole("button", { name: "March 2026" }));
    await user.click(screen.getByRole("button", { name: "March 2026" }));
    expect(onChange).toHaveBeenCalledWith("2026-03-01", "2026-03-01");
  });

  it("spans years: start in one year, end in another", async () => {
    const { open, user, onChange } = setup();
    await open();
    await user.click(screen.getByRole("button", { name: "June 2026" }));
    await user.click(screen.getByRole("button", { name: "Previous year" }));
    await user.click(screen.getByRole("button", { name: "Previous year" }));
    await user.click(screen.getByRole("button", { name: "October 2024" }));
    expect(onChange).toHaveBeenCalledWith("2024-10-01", "2026-06-01");
  });

  it("previews the range under the pointer before the second click", async () => {
    const { open, user, months } = setup();
    await open();
    await user.click(screen.getByRole("button", { name: "February 2026" }));
    await user.hover(screen.getByRole("button", { name: "May 2026" }));
    const pressed = within(months())
      .getAllByRole("button", { pressed: true })
      .map((b) => b.getAttribute("aria-label"));
    expect(pressed).toEqual(["February 2026", "March 2026", "April 2026", "May 2026"]);
  });

  it("disables months outside min and max, and year arrows at the ends", async () => {
    const { open, user } = setup();
    await open();
    expect(screen.getByRole("button", { name: "December 2026" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "November 2026" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next year" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /Choose year/ }));
    await user.click(screen.getByRole("button", { name: "1985" }));
    expect(screen.getByRole("button", { name: "March 1985" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "April 1985" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Previous year" })).toBeDisabled();
  });

  it("lists every year from max down to min in the year grid", async () => {
    const { open, user } = setup();
    await open();
    await user.click(screen.getByRole("button", { name: /Choose year/ }));
    const years = within(screen.getByRole("group", { name: "Years" }))
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(years).toHaveLength(2026 - 1985 + 1);
    expect(years[0]).toBe("2026");
    expect(years.at(-1)).toBe("1985");
  });

  it.each([
    ["This month", "2026-11-01", "2026-11-01"],
    ["Last 3 months", "2026-09-01", "2026-11-01"],
    ["Last 12 months", "2025-12-01", "2026-11-01"],
    ["This year", "2026-01-01", "2026-11-01"],
    ["Last year", "2025-01-01", "2025-12-01"],
    ["All time", "1985-04-01", "2026-11-01"],
  ])("the %s preset picks %s to %s", async (label, from, to) => {
    const { open, user, onChange } = setup();
    await open();
    await user.click(screen.getByRole("button", { name: label }));
    expect(onChange).toHaveBeenCalledWith(from, to);
  });

  it("clamps presets to the first recorded month and disables ones before it", async () => {
    const { open, user, onChange } = setup({ min: "2026-10-01" });
    await open();
    expect(screen.getByRole("button", { name: "Last year" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Last 12 months" }));
    expect(onChange).toHaveBeenCalledWith("2026-10-01", "2026-11-01");
  });

  it("forgets a half-picked range when closed and reopened", async () => {
    const { open, user, onChange } = setup();
    await open();
    await user.click(screen.getByRole("button", { name: "March 2026" }));
    await user.keyboard("{Escape}");
    await open();
    expect(screen.getByText("Pick a start month, then an end month.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "May 2026" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
