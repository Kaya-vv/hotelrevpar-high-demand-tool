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
    expect(screen.queryByText("Verhoogd")).not.toBeInTheDocument();
    expect(screen.queryByText("Laag")).not.toBeInTheDocument();
    expect(screen.queryByText("Handmatige inschatting")).not.toBeInTheDocument();
  });

  it("shows score overrides only when the platform-admin action is supplied", () => {
    render(
      <CalendarView
        month="2027-10"
        events={events}
        overrideImportanceAction={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Handmatige inschatting").length).toBeGreaterThan(0);
  });

  it("keeps the month calendar as an alternate view with scores in the agenda", () => {
    render(<CalendarView month="2027-10" events={events} view="calendar" />);
    expect(screen.getByLabelText("Maand 2027-10")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Gebeurtenissen deze maand")
    ).toHaveTextContent("78");
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
    act(() => vi.advanceTimersByTime(15_000));
    expect(refresh).toHaveBeenCalledOnce();
  });
  it("keeps refreshing after collection finishes until background publication finishes", () => {
    vi.useFakeTimers();
    const run = { startedAt: "2027-10-01T10:00:00Z", finishedAt: "2027-10-01T10:00:15Z", researchPending: true };
    const { rerender } = render(<CalendarView month="2027-10" events={events} latestRun={run} />);
    expect(screen.getByText(/Bijwerken bezig: onderzoek en publicatie/)).toBeInTheDocument();
    expect(screen.queryByText(/Bijgewerkt op/)).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(15_000));
    expect(refresh).toHaveBeenCalledOnce();
    rerender(<CalendarView month="2027-10" events={events} latestRun={{ ...run, researchPending: false }} />);
    expect(screen.getByText(/Bijgewerkt op/)).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(15_000));
    expect(refresh).toHaveBeenCalledOnce();
  });
  it("stops watching a run that stays pending and offers a manual reload instead", () => {
    vi.useFakeTimers();
    const run = { startedAt: "2027-10-01T10:00:00Z", finishedAt: null, researchPending: true };
    render(<CalendarView month="2027-10" events={events} latestRun={run} />);

    // Ten minutes of watching, then the poll must stop rather than run for the batch's lifetime.
    act(() => vi.advanceTimersByTime(10 * 60_000));
    const polls = refresh.mock.calls.length;
    expect(polls).toBe(39);
    expect(screen.getByRole("button", { name: "Nu verversen" })).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(60 * 60_000));
    expect(refresh).toHaveBeenCalledTimes(polls);
  });
});
