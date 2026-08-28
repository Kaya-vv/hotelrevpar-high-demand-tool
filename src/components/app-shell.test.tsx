import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "./app-shell";

describe("AppShell", () => {
  it("renders the approved Dutch navigation without an account-wide refresh action", () => {
    render(
      <AppShell accountName="Robert">
        <p>Inhoud</p>
      </AppShell>,
    );

    expect(screen.getByRole("navigation")).toHaveTextContent("Vraagkalender");
    expect(screen.getByRole("navigation")).toHaveTextContent("Te beoordelen");
    expect(screen.queryByRole("button", { name: "Nu verversen" })).not.toBeInTheDocument();
    expect(screen.getByText("Robert")).toBeVisible();
  });

  it("shows subscriber management to platform administrators", () => {
    render(<AppShell accountName="Robert" isPlatformAdmin><p>Inhoud</p></AppShell>);

    expect(screen.getByRole("link", { name: "Abonnees" })).toHaveAttribute("href", "/admin/accounts");
  });
});
