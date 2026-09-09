import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ExportControls } from "./export-controls";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(cleanup);

it("requires an explicit announcement checkbox and level and makes re-export deliberate", () => {
  render(<ExportControls events={[{ id: "event", title: "Future Congress", startAt: "2027-10-01", endAt: "2027-10-03", hotels: [{ id: "hotel", code: "H", importance: "Medium", impactBasis: "demand_rule", announced: true }] }]} hotelIds={["hotel"]} hotelNames={{ hotel: "Hotel" }} from="2026-09-08" to="2027-12-31" />);
  expect(screen.getByRole("button", { name: "Nieuwe events exporteren" })).toBeDisabled();
  fireEvent.click(screen.getByLabelText("Selecteer Future Congress voor Hotel"));
  expect(screen.getByText("Kies een exportniveau voor iedere geselecteerde aankondiging.")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Exportniveau Future Congress voor Hotel"), { target: { value: "Low" } });
  expect(screen.getByRole("button", { name: "Nieuwe events exporteren" })).toBeEnabled();
  expect(screen.getByText("1 events geselecteerd · 1 Excel-rijen")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Exportmodus"), { target: { value: "all" } });
  expect(screen.getByText(/Opnieuw importeren kan duplicaten/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Bewust opnieuw exporteren" })).toBeDisabled();
});

it("groups selections by hotel and keeps the Excel preview collapsed", () => {
  const { container } = render(<ExportControls events={[{ id: "event", title: "Congress", startAt: "2027-10-01", endAt: "2027-10-03", hotels: [
    { id: "a", code: "A", importance: "High", impactBasis: "demand_rule" },
    { id: "b", code: "B", importance: "High", impactBasis: "demand_rule" },
  ] }]} hotelIds={["a", "b"]} hotelNames={{ a: "Hotel A", b: "Hotel B" }} from="2026-09-08" to="2027-12-31" />);
  expect(within(screen.getByRole("region", { name: "Hotel A" })).getByText("Congress")).toBeVisible();
  expect(within(screen.getByRole("region", { name: "Hotel B" })).getByText("Congress")).toBeVisible();
  expect(screen.getByText("1 events geselecteerd · 1 Excel-rijen")).toBeVisible();
  const disclosure = container.querySelector("details")!;
  expect(disclosure).not.toHaveAttribute("open");
  fireEvent.click(screen.getByText("Bekijk Excel-voorbeeld"));
  expect(disclosure).toHaveAttribute("open");
  expect(within(disclosure).getByText("A, B")).toBeInTheDocument();
});
