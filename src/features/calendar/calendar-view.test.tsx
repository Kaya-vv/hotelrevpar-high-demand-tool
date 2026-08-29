import { act, cleanup, render, screen } from "@testing-library/react";
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
    certainty: "confirmed",
    sources: [
      {
        provider: "predicthq",
        url: "https://example.com/ddw",
        state: "predicted",
        primarySourceConfirmed: true,
      },
    ],
    hotelScores: [
      {
        hotelId: "hotel-1",
        hotelName: "MATCH",
        total: 78,
        importance: "High",
        impactBasis: "attendance",
        impactPoints: 60,
        distancePoints: 12,
        stayPressurePoints: 6,
        distanceKm: 8,
      },
      {
        hotelId: "hotel-2",
        hotelName: "Parkzicht",
        total: 55,
        importance: "Medium",
        impactBasis: "attendance",
        impactPoints: 45,
        distancePoints: 6,
        stayPressurePoints: 4,
        distanceKm: 19,
      },
    ],
  },
];

describe("CalendarView", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    refresh.mockClear();
  });

  it("shows every event score in the default overview without opening details", () => {
    render(<CalendarView month="2027-10" events={events} />);
    expect(
      screen.getByRole("region", { name: "Vraagmomenten met scores" })
    ).toBeInTheDocument();
    expect(screen.getByText("78")).toBeVisible();
    expect(screen.getByText("bevestigde vraagmomenten")).toBeVisible();
    expect(screen.getAllByText("Dutch Design Week").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Hoog").length).toBeGreaterThan(0);
    expect(
      screen.getByText(/berekeningsbasis: attendance/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /bekijk evenement/i })
    ).toHaveAttribute("href", "https://example.com/ddw");
    expect(screen.getByText("60 punten")).toBeInTheDocument();
  });

  it("keeps the month calendar as an alternate view with scores in the agenda", () => {
    render(<CalendarView month="2027-10" events={events} view="calendar" />);
    expect(screen.getByLabelText("Maand 2027-10")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Gebeurtenissen deze maand")
    ).toHaveTextContent("78");
  });

  it("keeps unverified events in a collapsed provisional section without an event link", () => {
    const provisional = {
      ...events[0],
      id: "event-provisional",
      title: "Potentiële Champions League wedstrijddag",
      certainty: "provisional" as const,
      sources: [
        {
          provider: "predicthq",
          url: "https://api.predicthq.com/v1/events/1",
          state: "predicted",
          primarySourceConfirmed: false,
        },
      ],
    };
    render(
      <CalendarView
        month="2027-10"
        events={[]}
        provisionalEvents={[provisional]}
      />
    );

    expect(screen.getByText("1 mogelijke vraagmomenten")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /bekijk evenement/i })
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/niet standaard in de export/i)
    ).toBeInTheDocument();
  });

  it("shows a hotel-friendly update status and refreshes an active collection", () => {
    vi.useFakeTimers();
    render(
      <CalendarView
        month="2027-10"
        events={events}
        latestRun={{ startedAt: "2027-10-01T10:00:00Z", finishedAt: null }}
      />
    );

    expect(screen.getByText(/bijwerken gestart/i)).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(3_000));
    expect(refresh).toHaveBeenCalledOnce();
  });
});
