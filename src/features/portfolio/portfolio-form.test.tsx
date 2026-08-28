import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PortfolioForm } from "./portfolio-form";

describe("PortfolioForm", () => {
  it("lets an operator manage collection from the hotel address", () => {
    render(
      <PortfolioForm
        hotels={[{
          id: "3d7ab09e-0915-45ec-a7bf-049199162c32",
          name: "MATCH",
          revcontrol_code: "MATCH",
          address: "Vestdijk 47, 5611CA Eindhoven",
          pdok_address_id: "address-1",
          latitude: 51.44,
          longitude: 5.48,
          demand_radius_km: 25,
          holiday_region: "south",
          enabled_sources: ["ticketmaster", "claude"],
        }]}
      />,
    );

    expect(screen.getByLabelText("Hotel MATCH bewerken")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Vestdijk 47, 5611CA Eindhoven")).toBeInTheDocument();
    expect(screen.queryByLabelText("Latitude")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Longitude")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Regio toevoegen" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Bronnen").length).toBeGreaterThan(0);
    expect(screen.getAllByDisplayValue("25")).toHaveLength(2);
  });
});
