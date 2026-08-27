import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "./app-shell";

describe("AppShell", () => {
  it("renders the approved Dutch navigation and refresh action", () => {
    render(
      <AppShell accountName="Robert">
        <p>Inhoud</p>
      </AppShell>,
    );

    expect(screen.getByRole("navigation")).toHaveTextContent("Vraagkalender");
    expect(screen.getByRole("navigation")).toHaveTextContent("Te beoordelen");
    expect(screen.getByRole("button", { name: "Nu verversen" })).toBeEnabled();
    expect(screen.getByText("Robert")).toBeVisible();
  });
});
