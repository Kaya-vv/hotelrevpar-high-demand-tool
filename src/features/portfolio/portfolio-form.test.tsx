import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PortfolioForm } from "./portfolio-form";

const hotel = {
  id: "3d7ab09e-0915-45ec-a7bf-049199162c32",
  name: "MATCH",
  revcontrol_code: "MATCH",
  address: "Vestdijk 47, 5611CA Eindhoven",
  pdok_address_id: "address-1",
  latitude: 51.44,
  longitude: 5.48,
  demand_radius_km: 25,
  holiday_region: "south" as const,
  enabled_sources: ["ticketmaster", "claude"],
};

describe("PortfolioForm", () => {
  afterEach(cleanup);

  it("shows the hotel list before its settings and hides source controls from operators", () => {
    render(<PortfolioForm hotels={[hotel]} isPlatformAdmin={false} />);
    expect(screen.getByRole("heading", { name: "MATCH" })).toBeInTheDocument();
    expect(screen.queryByText("Datakwaliteit")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
    expect(
      screen.getByDisplayValue("Vestdijk 47, 5611CA Eindhoven")
    ).toBeInTheDocument();
    expect(screen.queryByText("Bronnen beheren")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Latitude")).not.toBeInTheDocument();
  });

  it("shows source controls to platform administrators", () => {
    render(<PortfolioForm hotels={[hotel]} isPlatformAdmin />);
    fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
    expect(screen.getAllByText("Bronnen beheren")).toHaveLength(2);
  });

  it("combines portfolio status and hotel actions in one card", () => {
    render(
      <PortfolioForm
        hotels={[hotel]}
        insights={[
          {
            id: hotel.id,
            name: hotel.name,
            nextDemand: {
              id: "event-1",
              title: "Dutch Design Week",
              startAt: "2027-10-16T10:00:00+02:00",
              importance: "High",
            },
            reviewCount: 2,
            updatedAt: "2027-09-01T10:00:00Z",
            status: "idle",
          },
        ]}
        isPlatformAdmin={false}
      />
    );

    expect(screen.getByText("Dutch Design Week")).toBeVisible();
    expect(screen.getByRole("button", { name: "Open vraagmomenten" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Alle hotels bijwerken" })).not.toBeInTheDocument();
  });
});
