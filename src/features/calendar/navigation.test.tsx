import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { calendarBounds, changeMonth, overviewMonth } from "./navigation";
import { MonthNavigation } from "./month-navigation";
import { CalendarFilters } from "./calendar-filters";

describe("calendar navigation", () => {
  afterEach(cleanup);
  it("uses Amsterdam today and the end of next year for the full overview", () => {
    expect(calendarBounds("2026-01", "list", "all", new Date("2026-12-31T23:30:00Z"))).toEqual({ start: "2027-01-01", end: "2028-12-31" });
  });

  it("clamps rolling periods at month ends and leap years", () => {
    expect(calendarBounds("2026-01", "list", "3", new Date("2026-01-31T12:00:00Z"))).toEqual({ start: "2026-01-31", end: "2026-04-30" });
    expect(calendarBounds("2024-02", "list", "12", new Date("2024-02-29T12:00:00Z"))).toEqual({ start: "2024-02-29", end: "2025-02-28" });
    expect(calendarBounds("2028-02")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
    expect(changeMonth("2026-12", 1)).toBe("2027-01");
  });

  it("groups ongoing events under the current month", () => {
    expect(overviewMonth("2026-08-30T12:00:00Z", "2026-09-08")).toBe("2026-09");
    expect(overviewMonth("2027-02-01T12:00:00Z", "2026-09-08")).toBe("2027-02");
  });

  it("jumps to a selected year and month while retaining filters and period", () => {
    const { container } = render(<MonthNavigation month="2026-12" todayMonth="2026-09" baseHref="/calendar?view=calendar&category=concert&importance=High&period=12" />);
    fireEvent.click(container.querySelector("summary")!);
    fireEvent.change(screen.getByLabelText("Jaar"), { target: { value: "2027" } });
    const january = screen.getByRole("link", { name: "januari" });
    expect(january).toHaveAttribute("href", "/calendar?view=calendar&category=concert&importance=High&period=12&month=2027-01");
    expect(screen.getByRole("link", { name: "Deze maand" }).getAttribute("href")).toContain("month=2026-09");
    fireEvent.keyDown(screen.getByLabelText("Jaar"), { key: "Escape" });
    expect(container.querySelector("details")).not.toHaveAttribute("open");
    expect(container.querySelector("summary")).toHaveFocus();
  });

  it("keeps the selected category even when the chosen period has no matching events", () => {
    const { container } = render(<CalendarFilters month="2026-09" view="list" period="all" category="concert" categories={[]} levels={[]} />);
    expect(screen.getByLabelText("Categorie")).toHaveValue("concert");
    expect(screen.getByLabelText("Periode")).toHaveValue("all");
    expect(new FormData(container.querySelector("form")!).get("view")).toBe("list");
  });
});
