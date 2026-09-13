import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { ExportPanel, ExportTabs } from "./export-tabs";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(window.location.search) }));
vi.mock("next/link", () => ({ default: ({ href, children, onNavigate, ...props }: { href: string; children: ReactNode; onNavigate: (event: { preventDefault: () => void }) => void }) => {
  const { prefetch: _prefetch, ...attributes } = props as { prefetch?: boolean };
  void _prefetch;
  return <a href={href} {...attributes} onClick={(event) => onNavigate(event)}>{children}</a>;
} }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, "", "/export"); });
function Views() {
  return <><ExportTabs initialView="new" newHref="/export?view=new&hotel=a&historyPage=2" historyHref="/export?view=history&hotel=a&historyPage=2" /><ExportPanel><input aria-label="My selection" defaultValue="" /></ExportPanel><ExportPanel history><p>Saved files</p></ExportPanel></>;
}
it("switches with native history and preserves the mounted export selection", () => {
  const push = vi.spyOn(window.history, "pushState");
  const { rerender } = render(<Views />);
  const input = screen.getByLabelText("My selection");
  fireEvent.change(input, { target: { value: "Selected announcement" } });
  fireEvent.click(screen.getByRole("link", { name: "Eerdere exports" }));
  expect(push).toHaveBeenCalledWith(null, "", "/export?view=history&hotel=a&historyPage=2");
  rerender(<Views />);
  expect(input).not.toBeVisible();
  expect(screen.getByText("Saved files")).toBeVisible();
  fireEvent.click(screen.getByRole("link", { name: "Nieuwe export" }));
  rerender(<Views />);
  expect(input).toBeVisible();
  expect(input).toHaveValue("Selected announcement");
  expect(screen.getByText("Saved files")).not.toBeVisible();
});
it("uses the URL view on history restoration, including the original URL without a view", () => {
  window.history.replaceState(null, "", "/export?view=history");
  const { rerender } = render(<Views />);
  expect(screen.getByText("Saved files")).toBeVisible();
  window.history.replaceState(null, "", "/export");
  rerender(<Views />);
  expect(screen.getByLabelText("My selection")).toBeVisible();
});
