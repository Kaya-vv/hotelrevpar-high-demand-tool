import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ExportControls } from "./export-controls";
import type { ExportEvent } from "./types";
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
const props = { hotelIds: ["hotel"], hotelNames: { hotel: "Hotel" }, from: "2026-09-08", to: "2027-12-31" };
const announcement: ExportEvent = { id: "event", title: "Future Congress", startAt: "2027-10-01", endAt: "2027-10-03", hotels: [{ id: "hotel", code: "H", importance: "Medium", impactBasis: "demand_rule", announced: true, exportLevel: "High" }] };
const ready: ExportEvent = { ...announcement, id: "ready", title: "Ready Congress", hotels: [{ id: "hotel", code: "H", importance: "High", impactBasis: "demand_rule" }] };

it("adds and removes an announcement in one choice without automatically reusing a saved level", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: "Test failure" }) });
  vi.stubGlobal("fetch", fetch);
  const { container } = render(<ExportControls {...props} events={[announcement]} />);
  expect(screen.getByRole("button", { name: "Download voor RevControl" })).toBeDisabled();
  expect(container.querySelector(".export-optional")).not.toHaveAttribute("open");
  fireEvent.click(screen.getByText("Optioneel toevoegen"));
  const choice = screen.getByLabelText("Exportniveau Future Congress voor Hotel");
  expect(choice).toHaveValue("");
  fireEvent.change(choice, { target: { value: "Low" } });
  expect(screen.getByText("1 event klaar voor export")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Download voor RevControl" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ mode: "new", selectedPairs: ["hotel:event"], choices: [{ eventId: "event", hotelId: "hotel", importance: "Low" }] });
  await screen.findByRole("alert");
  fireEvent.change(choice, { target: { value: "" } });
  expect(screen.getByRole("button", { name: "Download voor RevControl" })).toBeDisabled();
});

it("hides previous exports and sorts new events chronologically", () => {
  const earlier = { ...ready, id: "earlier", title: "Earlier", startAt: "2026-10-01", endAt: "2026-10-01" };
  const exported = { ...ready, id: "exported", title: "Already exported", hotels: [{ ...ready.hotels[0], exportedAt: "2026-09-01" }] };
  const { container } = render(<ExportControls {...props} events={[ready, exported, earlier]} />);
  expect(screen.queryByText("Already exported")).not.toBeInTheDocument();
  expect([...container.querySelectorAll(".export-event-table tbody tr:not(.export-month) td:first-child")].map((cell) => cell.textContent)).toEqual(["Earlier", "Ready Congress"]);
  expect(screen.getByText("1 okt 2026")).toBeInTheDocument();
  expect(screen.getByText("2 events klaar voor export")).toBeInTheDocument();
});

it("groups hotels and keeps workbook details collapsed", () => {
  const { container } = render(<ExportControls events={[{ ...ready, hotels: [ { ...ready.hotels[0], id: "a", code: "A" }, { ...ready.hotels[0], id: "b", code: "B" } ] }]} hotelIds={["a", "b"]} hotelNames={{ a: "Hotel A", b: "Hotel B" }} from={props.from} to={props.to} />);
  expect(within(screen.getByRole("region", { name: "Hotel A" })).getByText("Ready Congress")).toBeVisible();
  expect(within(screen.getByRole("region", { name: "Hotel B" })).getByText("Ready Congress")).toBeVisible();
  const disclosure = container.querySelector(".export-file-details")!;
  expect(disclosure).not.toHaveAttribute("open");
  fireEvent.click(screen.getByText("Bekijk bestandsdetails"));
  expect(within(disclosure as HTMLElement).getByText("A, B")).toBeVisible();
});

it("requires deliberate selection for re-export, including select all without opting in announcements", () => {
  render(<ExportControls {...props} events={[ready, announcement]} reexport />);
  expect(screen.getByText(/Opnieuw importeren kan duplicaten/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Bewust opnieuw exporteren" })).toBeDisabled();
  fireEvent.click(screen.getByLabelText("Alle 1 events selecteren"));
  expect(screen.getByText("1 event klaar voor export")).toBeVisible();
  fireEvent.click(screen.getByLabelText("Alle 1 events selecteren"));
  expect(screen.getByRole("button", { name: "Bewust opnieuw exporteren" })).toBeDisabled();
});

it("refreshes a conflicting selection without automatically submitting another export", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({}) });
  vi.stubGlobal("fetch", fetch);
  const { rerender } = render(<ExportControls {...props} events={[ready]} />);
  fireEvent.click(screen.getByRole("button", { name: "Download voor RevControl" }));
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  rerender(<ExportControls {...props} events={[{ ...ready, hotels: [{ ...ready.hotels[0], exportedAt: "2026-09-13" }] }]} />);
  expect(screen.getByText(/De beschikbaarheid is veranderd/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Download voor RevControl" })).toBeDisabled();
  expect(fetch).toHaveBeenCalledOnce();
});
