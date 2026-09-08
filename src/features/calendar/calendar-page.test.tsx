import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CalendarPage from "@/app/(protected)/calendar/page";

const { getCalendarData } = vi.hoisted(() => ({ getCalendarData: vi.fn(async () => ({
  events: [], latestRun: null, hotels: [{ id: "hotel", name: "Selected hotel" }], selectedHotelId: "hotel", categories: ["concert"],
})) }));
vi.mock("./query", () => ({ getCalendarData }));
vi.mock("@/lib/auth/require-account", () => ({ requireAccount: async () => ({ accountId: "account", role: "member" }) }));
vi.mock("@/features/review/actions", () => ({ overrideImportance: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("calendar page", () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("defaults to the full overview and keeps filters in the month calendar link", async () => {
    render(await CalendarPage({ searchParams: Promise.resolve({ month: "2027-05", category: "concert", importance: "High" }) }));
    expect(getCalendarData).toHaveBeenCalledWith("account", { month: "2027-05", view: "list", period: "all", category: "concert", importance: "High" });
    expect(screen.getByRole("link", { name: "Overzicht" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Maandkalender" })).toHaveAttribute("href", "/calendar?month=2027-05&view=calendar&period=all&category=concert&importance=High");
    expect(screen.getByRole("heading", { name: "Selected hotel" })).toBeInTheDocument();
    expect(screen.getByLabelText("Periode")).toHaveValue("all");
  });

  it("retains the overview period when viewing a particular calendar month", async () => {
    render(await CalendarPage({ searchParams: Promise.resolve({ view: "calendar", month: "2027-05", period: "3", category: "concert" }) }));
    expect(screen.getByRole("link", { name: "Overzicht" })).toHaveAttribute("href", "/calendar?month=2027-05&view=list&period=3&category=concert");
    expect(screen.getByRole("link", { name: "Maandkalender" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByLabelText("Periode")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Maand 2027-05")).toBeInTheDocument();
  });
});
