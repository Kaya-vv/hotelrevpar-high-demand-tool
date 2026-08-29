import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ReviewList } from "./review-list";

const action = vi.fn();
const actions = { accept: action, keepCurrent: action, applyChange: action, edit: action, exclude: action, merge: action };

describe("ReviewList", () => {
  it("shows a duplicate comparison without exposing event IDs", () => {
    render(
      <ReviewList
        events={[{
          id: "event-1",
          title: "Dutch Design Week",
          venue: "Klokgebouw",
          startAt: "2027-10-16T10:00:00Z",
          endAt: "2027-10-24T22:00:00Z",
          reviewReason: "duplicate_uncertain",
          proposed: null,
          target: { title: "Dutch Design Week 2027", venue: "Klokgebouw", startAt: "2027-10-16T10:00:00Z", endAt: "2027-10-24T22:00:00Z" },
          sources: [{ provider: "claude", url: "https://venue.nl/event", state: "active", primarySourceConfirmed: false }],
        }]}
        actions={actions}
      />,
    );
    expect(screen.getByText("Mogelijk hetzelfde evenement")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zelfde evenement" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apart behouden" })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/event-id/i)).not.toBeInTheDocument();
  });

  it("shows current and proposed values for a changed date", () => {
    render(
      <ReviewList
        events={[{
          id: "event-2",
          title: "Concert",
          venue: "Arena",
          startAt: "2027-10-16T10:00:00Z",
          endAt: "2027-10-16T22:00:00Z",
          reviewReason: "changed_date",
          proposed: { title: "Concert", venue: "Arena", startAt: "2027-10-17T10:00:00Z", endAt: "2027-10-17T22:00:00Z" },
          target: null,
          sources: [],
        }]}
        actions={actions}
      />,
    );
    expect(screen.getByText("Huidig")).toBeInTheDocument();
    expect(screen.getByText("Nieuwe informatie")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wijziging overnemen" })).toBeInTheDocument();
  });
});
