import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/calendar",
  useRouter: () => ({ refresh: vi.fn() }),
}));

const workspace = {
  hotels: [{ id: "hotel-1", name: "Hotel", accountId: "own", accountName: "Robert" }],
  selectedHotelId: "hotel-1",
  reviewCount: 2,
  batch: null,
};

describe("AppShell", () => {
  afterEach(cleanup);

  it("renders the approved Dutch navigation without an account-wide refresh action", () => {
    render(
      <AppShell accountName="Robert" {...workspace}>
        <p>Inhoud</p>
      </AppShell>
    );

    expect(screen.getByRole("navigation")).not.toHaveTextContent("Dashboard");
    expect(screen.getByRole("navigation")).toHaveTextContent("Overzicht");
    expect(screen.getByRole("navigation")).not.toHaveTextContent(
      "Te beoordelen"
    );
    expect(screen.getByRole("navigation")).not.toHaveTextContent(
      "Datakwaliteit"
    );
    expect(
      screen.queryByRole("button", { name: "Nu verversen" })
    ).not.toBeInTheDocument();
    expect(screen.getByText("Robert")).toBeVisible();
  });

  it("shows subscriber management to platform administrators", () => {
    render(
      <AppShell accountName="Robert" isPlatformAdmin {...workspace}>
        <p>Inhoud</p>
      </AppShell>
    );

    expect(screen.getByRole("link", { name: "Abonnees" })).toHaveAttribute(
      "href",
      "/admin/accounts"
    );
    expect(screen.getByRole("link", { name: /Datakwaliteit/ })).toHaveAttribute(
      "href",
      "/review"
    );
  });

  it("labels subscriber hotels with their account while the administrator looks along", () => {
    render(
      <AppShell
        accountName="Sandton Eindhoven"
        isPlatformAdmin
        viewingOtherAccount
        hotels={[
          { id: "hotel-1", name: "Hotel", accountId: "own", accountName: "Robert" },
          { id: "hotel-2", name: "Resort Bad Boekelo", accountId: "sandton", accountName: "Sandton Eindhoven" },
        ]}
        selectedHotelId="hotel-2"
        reviewCount={0}
        batch={null}
      >
        <p>Inhoud</p>
      </AppShell>
    );

    expect(screen.getByText("Meekijken bij")).toBeVisible();
    expect(screen.getByText("Sandton Eindhoven", { selector: "strong" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Terug naar mijn eigen hotels" })).toBeVisible();
    expect(screen.getByRole("group", { name: "Robert" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Resort Bad Boekelo" })).toBeInTheDocument();
    expect(screen.getByLabelText("Actief hotel")).toHaveValue("hotel-2");
  });
});
