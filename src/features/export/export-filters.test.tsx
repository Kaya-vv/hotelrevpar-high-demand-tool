import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ExportFilters } from "./export-filters";
const replace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const props = { hotels: [{ id: "a", name: "Hotel A" }, { id: "b", name: "Hotel B" }], hotelIds: ["a"], from: "2026-09-13", to: "2027-12-31", view: "new" };
it("updates hotels without an apply button and keeps the controls expanded", () => {
  const { container } = render(<ExportFilters {...props}><button>Download</button></ExportFilters>);
  fireEvent.click(screen.getByText("Aanpassen"));
  fireEvent.click(screen.getByLabelText("Hotel B"));
  expect(replace).toHaveBeenCalledWith("/export?selection=1&view=new&from=2026-09-13&to=2027-12-31&hotel=a&hotel=b", { scroll: false });
  expect(container.querySelector("details")).toHaveAttribute("open");
});
it("updates dates after editing and rejects an invalid range", () => {
  render(<ExportFilters {...props}>Content</ExportFilters>);
  fireEvent.click(screen.getByText("Aanpassen"));
  const from = screen.getByLabelText("Van");
  fireEvent.change(from, { target: { value: "2026-10-01" } });
  expect(replace).not.toHaveBeenCalled();
  fireEvent.blur(from);
  expect(replace).toHaveBeenCalledWith(expect.stringContaining("from=2026-10-01"), { scroll: false });
  replace.mockClear();
  fireEvent.change(from, { target: { value: "2028-01-01" } });
  fireEvent.blur(from);
  expect(replace).not.toHaveBeenCalled();
});
