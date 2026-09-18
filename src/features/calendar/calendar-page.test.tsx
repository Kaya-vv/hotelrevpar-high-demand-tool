import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CalendarPage from "@/app/(protected)/calendar/page";

const { getCalendarData, viewedAccount } = vi.hoisted(() => ({
  getCalendarData: vi.fn(async () => ({
    events: [], latestRun: null, hotels: [{ id: "hotel", name: "Selected hotel" }], selectedHotelId: "hotel", categories: ["concert"],
  })),
  viewedAccount: {
    accountId: "account", accountName: "Robert", role: "operator" as "operator" | "platform_admin", userId: "user",
    viewedAccountId: "account", viewedAccountName: "Robert", viewingOtherAccount: false,
  },
}));
vi.mock("./query", () => ({ getCalendarData }));
vi.mock("@/features/workspace/viewed-account", () => ({ requireViewedAccount: async () => viewedAccount }));
vi.mock("@/features/review/actions", () => ({ overrideImportance: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("calendar page", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    Object.assign(viewedAccount, {
      role: "operator", viewedAccountId: "account", viewedAccountName: "Robert", viewingOtherAccount: false,
    });
  });

  it("defaults to the full overview and keeps filters in the month calendar link", async () => {
    render(await CalendarPage({ searchParams: Promise.resolve({ month: "2027-05", category: "concert", importance: "High" }) }));
    expect(getCalendarData).toHaveBeenCalledWith("account", { month: "2027-05", view: "list", period: "all", category: "concert", importance: "High", includeMedium: false });
    expect(screen.getByRole("link", { name: "Overzicht" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Maandkalender" })).toHaveAttribute("href", "/calendar?month=2027-05&view=calendar&period=all&category=concert&importance=High");
    expect(screen.getByRole("heading", { name: "Selected hotel" })).toBeInTheDocument();
    expect(screen.getByLabelText("Periode")).toHaveValue("all");
  });

  it("passes the Medium toggle to the query and keeps it in the links", async () => {
    render(await CalendarPage({ searchParams: Promise.resolve({ month: "2027-05", medium: "1", importance: "Medium" }) }));
    expect(getCalendarData).toHaveBeenCalledWith("account", { month: "2027-05", view: "list", period: "all", category: undefined, importance: "Medium", includeMedium: true });
    expect(screen.getByLabelText("Ook Medium-events tonen")).toBeChecked();
    expect(screen.getByRole("link", { name: "Maandkalender" })).toHaveAttribute("href", "/calendar?month=2027-05&view=calendar&period=all&importance=Medium&medium=1");
  });

  it("retains the overview period when viewing a particular calendar month", async () => {
    render(await CalendarPage({ searchParams: Promise.resolve({ view: "calendar", month: "2027-05", period: "3", category: "concert" }) }));
    expect(screen.getByRole("link", { name: "Overzicht" })).toHaveAttribute("href", "/calendar?month=2027-05&view=list&period=3&category=concert");
    expect(screen.getByRole("link", { name: "Maandkalender" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByLabelText("Periode")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Maand 2027-05")).toBeInTheDocument();
  });

  it("says the administrator is only looking along in a subscriber account", async () => {
    Object.assign(viewedAccount, {
      role: "platform_admin", viewedAccountId: "subscriber", viewedAccountName: "Sandton Eindhoven", viewingOtherAccount: true,
    });
    render(await CalendarPage({ searchParams: Promise.resolve({}) }));

    expect(getCalendarData).toHaveBeenCalledWith("subscriber", expect.anything());
    expect(screen.getByRole("status")).toHaveTextContent("Je kijkt mee in het account van Sandton Eindhoven");
  });
});
