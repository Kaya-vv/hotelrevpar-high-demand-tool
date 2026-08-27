import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ReviewList } from "./review-list";

describe("ReviewList", () => {
  it("shows the reason, source, and decision controls", () => {
    const action = vi.fn();
    render(
      <ReviewList
        events={[{
          id: "event-1",
          title: "Possible duplicate",
          venue: "Klokgebouw",
          startAt: "2027-10-16T10:00:00Z",
          endAt: "2027-10-16T22:00:00Z",
          reviewReason: "duplicate_uncertain",
          sources: [{ provider: "claude", url: "https://venue.nl/event", state: "active", primarySourceConfirmed: false }],
        }]}
        actions={{ accept: action, edit: action, exclude: action, merge: action }}
      />,
    );
    expect(screen.getByText("Mogelijk duplicaat")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /claude/i })).toHaveAttribute("href", "https://venue.nl/event");
    expect(screen.getByRole("button", { name: "Accepteren" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bewerken" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Uitsluiten" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Samenvoegen" })).toBeInTheDocument();
  });
});
