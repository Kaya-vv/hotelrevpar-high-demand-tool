import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CalendarView, type CalendarEvent } from "./calendar-view";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const events: CalendarEvent[] = [
  {
    id: "event-1",
    title: "Dutch Design Week",
    category: "festival",
    venue: "Klokgebouw",
    startAt: "2027-10-16T10:00:00+02:00",
    endAt: "2027-10-24T22:00:00+02:00",
    certainty: "provisional",
    sources: [{ provider: "predicthq", url: "https://example.com/ddw", state: "predicted", primarySourceConfirmed: true }],
    hotelScores: [
      { hotelId: "hotel-1", hotelName: "MATCH", total: 78, importance: "High", impactBasis: "attendance", impactPoints: 60, distancePoints: 12, stayPressurePoints: 6, distanceKm: 8 },
      { hotelId: "hotel-2", hotelName: "Parkzicht", total: 55, importance: "Medium", impactBasis: "attendance", impactPoints: 45, distancePoints: 6, stayPressurePoints: 4, distanceKm: 19 },
    ],
  },
];

describe("CalendarView", () => {
  afterEach(() => {
    vi.useRealTimers();
    refresh.mockClear();
  });

  it("renders the month, provisional evidence, and separate hotel scores", () => {
    render(<CalendarView month="2027-10" events={events} />);
    expect(screen.getAllByText("Dutch Design Week").length).toBeGreaterThan(1);
    expect(screen.getByText("Voorlopig")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByText("Medium")).toBeInTheDocument();
    expect(screen.getAllByText(/attendance/).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /predicthq/i })).toHaveAttribute("href", "https://example.com/ddw");
    expect(screen.getByText(/60 impact.*12 afstand.*6 verblijf/i)).toBeInTheDocument();
  });

  it("shows a hotel-friendly update status and refreshes an active collection", () => {
    vi.useFakeTimers();
    render(
      <CalendarView
        month="2027-10"
        events={events}
        latestRun={{ startedAt: "2027-10-01T10:00:00Z", finishedAt: null }}
      />,
    );

    expect(screen.getByText(/gegevens worden bijgewerkt/i)).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(3_000));
    expect(refresh).toHaveBeenCalledOnce();
  });
});

