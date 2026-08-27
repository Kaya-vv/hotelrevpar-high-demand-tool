import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PortfolioForm } from "./portfolio-form";

describe("PortfolioForm", () => {
  it("lets an operator edit an existing hotel and collection area", () => {
    render(
      <PortfolioForm
        hotels={[{
          id: "3d7ab09e-0915-45ec-a7bf-049199162c32",
          name: "MATCH",
          revcontrol_code: "MATCH",
          address: "Eindhoven",
          latitude: 51.44,
          longitude: 5.48,
          demand_radius_km: 25,
          holiday_region: "south",
        }]}
        areas={[{
          id: "df806782-89cf-47d4-9a9a-c0f9fb86a08d",
          name: "Eindhoven",
          latitude: 51.44,
          longitude: 5.48,
          radius_km: 30,
          enabled_sources: ["ticketmaster", "claude"],
        }]}
      />,
    );

    expect(screen.getByLabelText("Hotel MATCH bewerken")).toBeInTheDocument();
    expect(screen.getByLabelText("Regio Eindhoven bewerken")).toBeInTheDocument();
    expect(screen.getAllByDisplayValue("25")).toHaveLength(2);
    expect(screen.getAllByDisplayValue("30")).toHaveLength(2);
  });
});
