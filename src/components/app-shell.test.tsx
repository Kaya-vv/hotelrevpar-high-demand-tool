import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/calendar",
  useRouter: () => ({ refresh: vi.fn() }),
}));

const workspace = {
  hotels: [{ id: "hotel-1", name: "Hotel" }],
  selectedHotelId: "hotel-1",
  reviewCount: 2,
  batch: null,
};

describe("AppShell", () => {
  it("renders the approved Dutch navigation without an account-wide refresh action", () => {
    render(
      <AppShell accountName="Robert" {...workspace}>
        <p>Inhoud</p>
      </AppShell>
    );

    expect(screen.getByRole("navigation")).not.toHaveTextContent("Dashboard");
    expect(screen.getByRole("navigation")).toHaveTextContent("Kalender");
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
});
