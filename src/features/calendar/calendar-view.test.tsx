import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RunStatusContext } from "@/features/collection/use-run-status-poll";
import { CalendarView, type CalendarEvent } from "./calendar-view";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const events: CalendarEvent[] = [
  {
    id: "event-1",
    demandAssessment: { version: 1, relevance: "probable", magnitude: "High", confidence: "medium", reasons: ["Reizend publiek met een meerdaags programma."], sourceUrls: ["https://example.com/ddw"] },
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
  it("groups future events by month, skips empty months and links to the filtered calendar", () => {
    render(<CalendarView month="2026-09" rangeStart="2026-09-08" events={[
      { ...events[0], id: "ongoing", title: "Ongoing festival", startAt: "2026-08-30T12:00:00Z", endAt: "2026-09-10T12:00:00Z" },
      ...events,
    ]} monthHrefs={{ "2027-10": "/calendar?view=calendar&month=2027-10&category=festival&period=all" }} />);
    expect(screen.getByRole("region", { name: "september 2026" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "oktober 2027" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "november 2026" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /oktober 2027/ })).toHaveAttribute("href", "/calendar?view=calendar&month=2027-10&category=festival&period=all");
    expect(screen.getAllByText("1 evenement")).toHaveLength(2);
  });

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
    // The `/100` suffix demands a number: the overview rendered "Hoog/100" beside a "Hoog" badge.
    expect(screen.getByText("78")).toBeVisible();
    expect(screen.getByText("bevestigde vraagmomenten")).toBeVisible();
    expect(screen.getAllByText("Dutch Design Week").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Hoog").length).toBeGreaterThan(0);
    expect(
      screen.getByText(/Omvang: Hoog/)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /bekijk evenement/i })
    ).toHaveAttribute("href", "https://example.com/ddw");
    expect(screen.queryByText("60 punten")).not.toBeInTheDocument();
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

  it("targets the hidden score row when an announced event has no publishable grade", () => {
    render(
      <CalendarView
        month="2027-10"
        events={[
          {
            ...events[0],
            announced: true,
            hotelScores: [],
            assessedScore: { ...events[0].hotelScores[0], importance: "Medium" },
          },
        ]}
        overrideImportanceAction={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Handmatige inschatting").length).toBeGreaterThan(0);
    expect(document.querySelector("input[name='hotelId']")).toHaveValue("hotel-1");
    expect(screen.getAllByLabelText(/Handmatige inschatting/)[0]).toHaveValue("Medium");
  });

  it("keeps the month calendar as an alternate view with scores in the agenda", () => {
    render(<CalendarView month="2027-10" events={events} view="calendar" />);
    expect(screen.getByLabelText("Maand 2027-10")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Gebeurtenissen deze maand")
    ).toHaveTextContent("Hoog");
  });

  it("shows update status without starting an independent refresh loop", () => {
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
    expect(refresh).not.toHaveBeenCalled();
  });
  it("keeps research pending until publication finishes", () => {
    vi.useFakeTimers();
    const run = { startedAt: "2027-10-01T10:00:00Z", finishedAt: "2027-10-01T10:00:15Z", researchPending: true };
    const { rerender } = render(<CalendarView month="2027-10" events={events} latestRun={run} />);
    expect(screen.getByText(/Bijwerken bezig: onderzoek en publicatie/)).toBeInTheDocument();
    expect(screen.queryByText(/Bijgewerkt op/)).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(15_000));
    expect(refresh).not.toHaveBeenCalled();
    rerender(<CalendarView month="2027-10" events={events} latestRun={{ ...run, researchPending: false }} />);
    expect(screen.getByText(/Bijgewerkt op/)).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(15_000));
    expect(refresh).not.toHaveBeenCalled();
  });
  it("stops watching a run that stays pending and offers a manual reload instead", () => {
    vi.useFakeTimers();
    const run = { startedAt: "2027-10-01T10:00:00Z", finishedAt: null, researchPending: true };
    render(<RunStatusContext.Provider value={{ expired: true, register: vi.fn(), resume: vi.fn() }}>
      <CalendarView month="2027-10" events={events} latestRun={run} />
    </RunStatusContext.Provider>);
    expect(screen.getByRole("button", { name: "Nu verversen" })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(60 * 60_000));
    expect(refresh).not.toHaveBeenCalled();
  });
});
