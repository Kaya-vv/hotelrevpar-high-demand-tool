import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { UnresolvedLocation } from "@/features/collection/unresolved-locations";

import { UnresolvedLocationsList } from "./unresolved-locations-list";

const resolve = vi.fn(async () => {});
const dismiss = vi.fn(async () => {});
const actions = { resolve, dismiss };

afterEach(cleanup);

function identity(form: HTMLFormElement) {
  return {
    areaId: (form.elements.namedItem("areaId") as HTMLInputElement).value,
    provider: (form.elements.namedItem("provider") as HTMLInputElement).value,
    providerEventId: (
      form.elements.namedItem("providerEventId") as HTMLInputElement
    ).value,
  };
}

const item: UnresolvedLocation = {
  areaId: "area-1",
  areaName: "Grand Hotel Ter Duin",
  provider: "claude",
  providerEventId: "event-42",
  horizon: "near_term",
  title: "Zeeuwse Kustdagen",
  venue: "Congrescentrum aan Zee",
  startDate: "2027-01-10",
  endDate: "2027-01-12",
  discoveredAt: "2026-09-14T12:00:00Z",
  sourceUrl: "https://example.com/kustdagen",
  locationText: "Het congres vindt plaats aan de Zeeuwse kust.",
  hostCity: "Burgh-Haamstede",
};

describe("UnresolvedLocationsList", () => {
  it("renders nothing for an empty queue", () => {
    const { container } = render(
      <UnresolvedLocationsList items={[]} actions={actions} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("shows the event details and submits the row identity", () => {
    const { container } = render(
      <UnresolvedLocationsList items={[item]} actions={actions} />,
    );

    expect(screen.getByRole("heading", { name: item.title })).toBeInTheDocument();
    expect(screen.getByText(item.areaName)).toBeInTheDocument();
    expect(screen.getByText(/10 jan 2027 tot 12 jan 2027/i)).toBeInTheDocument();

    const [resolveForm, dismissForm] = container.querySelectorAll("form");
    const address = screen.getByRole("textbox");
    expect(identity(resolveForm)).toEqual({
      areaId: item.areaId,
      provider: item.provider,
      providerEventId: item.providerEventId,
    });
    expect(address).toHaveValue("");
    expect(address).toBeRequired();
    expect(within(resolveForm).getByRole("button")).toBeEnabled();
    expect(identity(dismissForm)).toEqual({
      areaId: item.areaId,
      provider: item.provider,
      providerEventId: item.providerEventId,
    });
  });

  it("keeps the address form usable without a venue or quoted passage", () => {
    render(
      <UnresolvedLocationsList
        items={[{ ...item, providerEventId: "event-43", venue: null, locationText: null }]}
        actions={actions}
      />,
    );

    expect(screen.getByRole("heading", { name: item.title })).toBeInTheDocument();
    const address = screen.getByRole("textbox");
    expect(address).toBeRequired();
    expect(within(address.closest("form")!).getByRole("button")).toBeEnabled();
  });
});
