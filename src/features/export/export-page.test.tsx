import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ExportPage from "@/app/(protected)/export/page";
vi.mock("@/features/workspace/viewed-account", () => ({ requireViewedAccount: async () => ({ accountId: "account", viewedAccountName: "Robert", viewingOtherAccount: false }) }));
vi.mock("@/features/workspace/hotel-context", () => ({ getHotelScope: async () => ({ hotels: [{ id: "hotel", name: "Hotel" }], selectedHotelId: "hotel" }) }));
vi.mock("./query", () => ({ exportRange: () => ({ start: "2026-09-08", end: "2027-12-31" }), loadExportEvents: async () => ({ events: [] }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams(window.location.search) }));
vi.mock("./history", () => ({ loadExportHistory: async () => [{
  id: "batch", created_at: "2026-09-08T12:00:00Z", selection: { from: "2026-09-08", to: "2027-12-31", hotelIds: ["hotel"] },
  items: [{ previous: { eventId: "event", hotelId: "hotel", title: "Congress", startDate: "2027-01-01", endDate: "2027-01-02", hotelCode: "H", importance: "High", status: "active" }, latest: true, changed: true, snapshot: null, eligible: false }],
}] }));
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/export"); });

it("keeps history out of the new export view but links to changed events", async () => {
  const { container } = render(await ExportPage({ searchParams: Promise.resolve({}) }));
  expect(container.querySelector(".export-history")).not.toBeVisible();
  expect(screen.getByRole("link", { name: "Nieuwe export" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Bekijk wijzigingen" })).toHaveAttribute("href", expect.stringContaining("view=history"));
  expect(container.querySelector(".export-filter-panel")).not.toHaveAttribute("open");
});

it("offers original downloads directly and expands only changed-event details", async () => {
  window.history.replaceState(null, "", "/export?view=history");
  render(await ExportPage({ searchParams: Promise.resolve({ view: "history" }) }));
  expect(screen.getByRole("link", { name: "Opnieuw downloaden" })).toHaveAttribute("href", "/api/export/batch");
  fireEvent.click(screen.getByText("1 event gewijzigd sinds export"));
  expect(screen.getByText(/Controleer en pas de bestaande vermelding/)).toBeVisible();
  expect(screen.getByRole("link", { name: "Nieuwe export van eerdere events" })).toHaveAttribute("href", expect.stringContaining("view=reexport"));
});

it("preserves the hotel and history destination during pagination", async () => {
  window.history.replaceState(null, "", "/export?historyPage=1");
  render(await ExportPage({ searchParams: Promise.resolve({ historyPage: "1" }) }));
  expect(screen.getByRole("link", { name: "Eerdere exports" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Nieuwere exports" })).toHaveAttribute("href", "/export?from=2026-09-08&to=2027-12-31&selection=1&hotel=hotel&view=history&historyPage=0");
});

it("preserves an explicitly empty hotel selection", async () => {
  render(await ExportPage({ searchParams: Promise.resolve({ selection: "1" }) }));
  expect(screen.getByText(/Kies een hotel via Aanpassen/)).toBeVisible();
  expect(screen.getByRole("link", { name: "Eerdere exports" })).toHaveAttribute("href", "/export?from=2026-09-08&to=2027-12-31&selection=1&view=history");
});
