import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ExportPage from "@/app/(protected)/export/page";

vi.mock("@/lib/auth/require-account", () => ({ requireAccount: async () => ({ accountId: "account" }) }));
vi.mock("@/features/workspace/hotel-context", () => ({ getHotelScope: async () => ({ hotels: [{ id: "hotel", name: "Hotel" }], selectedHotelId: "hotel" }) }));
vi.mock("./query", () => ({ exportRange: () => ({ start: "2026-09-08", end: "2027-12-31" }), loadExportEvents: async () => ({ events: [] }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./history", () => ({ loadExportHistory: async () => [{
  id: "batch", created_at: "2026-09-08T12:00:00Z", selection: { from: "2026-09-08", to: "2027-12-31", hotelIds: ["hotel"] },
  items: [{ previous: { eventId: "event", hotelId: "hotel", title: "Congress", startDate: "2027-01-01", endDate: "2027-01-02", hotelCode: "H", importance: "High", status: "active" }, latest: true, changed: true, snapshot: null, eligible: false }],
}] }));

afterEach(cleanup);

it("collapses history but keeps changed-export alerts and original downloads accessible", async () => {
  const { container } = render(await ExportPage({ searchParams: Promise.resolve({}) }));
  const history = container.querySelector(".export-history")!;
  expect(history).not.toHaveAttribute("open");
  expect(history.querySelector("summary")).toHaveTextContent("1 exports");
  expect(history.querySelector("summary")).toHaveTextContent("Gewijzigd sinds export");
  fireEvent.click(history.querySelector("summary")!);
  expect(screen.getByRole("link", { name: "Oorspronkelijk bestand opnieuw downloaden" })).toHaveAttribute("href", "/api/export/batch");
  fireEvent.click(history.querySelector("details")!.querySelector("summary")!);
  expect(screen.getByText(/Controleer en pas de bestaande vermelding/)).toBeVisible();
});

it("opens history when navigating between history pages", async () => {
  const { container } = render(await ExportPage({ searchParams: Promise.resolve({ historyPage: "1" }) }));
  expect(container.querySelector(".export-history")).toHaveAttribute("open");
  expect(screen.getByRole("link", { name: "Nieuwere exports" })).toHaveAttribute("href", "/export?from=2026-09-08&to=2027-12-31&hotel=hotel&historyPage=0#export-history");
});
