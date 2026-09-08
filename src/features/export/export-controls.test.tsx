import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ExportControls } from "./export-controls";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

it("requires an explicit announcement checkbox and level and makes re-export deliberate", () => {
  render(<ExportControls events={[{ id: "event", title: "Future Congress", startAt: "2027-10-01", endAt: "2027-10-03", hotels: [{ id: "hotel", code: "H", importance: "Medium", impactBasis: "ai_assessment", announced: true }] }]} hotelIds={["hotel"]} hotelNames={{ hotel: "Hotel" }} from="2026-09-08" to="2027-12-31" />);
  expect(screen.getByRole("button", { name: "Nieuwe events exporteren" })).toBeDisabled();
  fireEvent.click(screen.getByLabelText("Selecteer Future Congress voor Hotel"));
  expect(screen.getByText("Kies een exportniveau voor iedere geselecteerde aankondiging.")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Exportniveau Future Congress voor Hotel"), { target: { value: "Low" } });
  expect(screen.getByRole("button", { name: "Nieuwe events exporteren" })).toBeEnabled();
  expect(screen.getByText("Voorbeeld: 1 events, 1 Excel-rijen")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Exportmodus"), { target: { value: "all" } });
  expect(screen.getByText(/Opnieuw importeren kan duplicaten/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Bewust opnieuw exporteren" })).toBeDisabled();
});
