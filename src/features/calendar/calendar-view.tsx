"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  demandLabels,
  demandLevels,
  publishableDemandLevels,
  type DemandLevel,
} from "@/features/events/importance";

export type CalendarSource = {
  id?: string;
  provider: string;
  url: string | null;
  state: string;
  primarySourceConfirmed: boolean;
};

export type CalendarHotelScore = {
  hotelId: string;
  hotelName: string;
  total: number;
  importance: DemandLevel;
  impactBasis: string;
  impactPoints: number;
  distancePoints: number;
  stayPressurePoints: number;
  distanceKm: number | null;
};

export type CalendarEvent = {
  id: string;
  title: string;
  category: string;
  venue: string | null;
  startAt: string;
  endAt: string;
  sources: CalendarSource[];
  hotelScores: CalendarHotelScore[];
};

export type LatestRun = {
  startedAt: string;
  finishedAt: string | null;
  hadErrors?: boolean;
};

function calendarDays(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const count = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const weekday = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
  const leading = (weekday + 6) % 7;
  return [
    ...Array.from({ length: leading }, () => null),
    ...Array.from(
      { length: count },
      (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`
    ),
  ];
}

function dateLabel(value: string, includeYear = false) {
  return new Intl.DateTimeFormat("nl-NL", {
    day: "numeric",
    month: "short",
    timeZone: "Europe/Amsterdam",
    ...(includeYear ? { year: "numeric" } : {}),
  }).format(new Date(value));
}

function dayOfMonth(value: string) {
  return new Intl.DateTimeFormat("nl-NL", {
    day: "numeric",
    timeZone: "Europe/Amsterdam",
  }).format(new Date(value));
}

function categoryLabel(value: string) {
  return value.replaceAll("_", " ");
}

function EventDetails({
  event,
  overrideImportanceAction,
}: {
  event: CalendarEvent;
  overrideImportanceAction?: (formData: FormData) => void | Promise<void>;
}) {
  const score = event.hotelScores[0];
  const primarySource = event.sources.find(
    (source) => source.primarySourceConfirmed && source.url
  );
  return (
    <article className="event-details">
      <header>
        <div>
          <span className="eyebrow">{categoryLabel(event.category)}</span>
          <h2>{event.title}</h2>
        </div>
        {score && (
          <span className={`importance ${score.importance.toLowerCase()}`}>
            {demandLabels[score.importance]}
          </span>
        )}
      </header>
      <p className="event-date">
        {dateLabel(event.startAt, true)} tot {dateLabel(event.endAt, true)}
      </p>
      {event.venue && <p>{event.venue}</p>}
      {score && (
        <div className="demand-summary">
          <strong>{score.total}/100</strong>
          <span>
            {score.distanceKm === null
              ? "Van toepassing op dit hotel"
              : `${score.distanceKm.toFixed(1)} km van het hotel`}
          </span>
        </div>
      )}
      {primarySource && (
        <a
          className="secondary link-button"
          href={primarySource.url!}
          target="_blank"
          rel="noreferrer"
        >
          Bekijk evenement
        </a>
      )}
      {score && (
        <details className="score-explanation">
          <summary>Waarom deze inschatting?</summary>
          <dl>
            <div>
              <dt>Verwachte impact</dt>
              <dd>{score.impactPoints} punten</dd>
            </div>
            <div>
              <dt>Afstand</dt>
              <dd>{score.distancePoints} punten</dd>
            </div>
            <div>
              <dt>Verblijfsdruk</dt>
              <dd>{score.stayPressurePoints} punten</dd>
            </div>
          </dl>
          <small>Berekeningsbasis: {score.impactBasis}</small>
          <div className="source-links">
            {event.sources
              .filter((source) => source.primarySourceConfirmed && source.url)
              .map((source) => (
                <a
                  href={source.url!}
                  key={`${source.provider}-${source.url}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {source.provider}
                </a>
              ))}
          </div>
          {overrideImportanceAction && (
            <form action={overrideImportanceAction} className="score-override">
              <input type="hidden" name="eventId" value={event.id} />
              <input type="hidden" name="hotelId" value={score.hotelId} />
              <label>
                Handmatige inschatting
                <select name="importance" defaultValue={score.importance}>
                  {demandLevels.map((level) => (
                    <option key={level} value={level}>
                      {demandLabels[level]}
                    </option>
                  ))}
                </select>
              </label>
              <button className="secondary" type="submit">
                Opslaan
              </button>
            </form>
          )}
        </details>
      )}
    </article>
  );
}

function EventOverview({
  events,
  overrideImportanceAction,
}: {
  events: CalendarEvent[];
  overrideImportanceAction?: (formData: FormData) => void | Promise<void>;
}) {
  const counts = Object.fromEntries(
    publishableDemandLevels.map((level) => [
      level,
      events.filter((event) => event.hotelScores[0]?.importance === level)
        .length,
    ])
  ) as Record<(typeof publishableDemandLevels)[number], number>;
  const rows = (items: CalendarEvent[]) =>
    items.map((event) => {
      const score = event.hotelScores[0];
      return (
        <details className="event-overview-item" key={event.id}>
          <summary>
            <time dateTime={event.startAt}>
              <strong>{dayOfMonth(event.startAt)}</strong>
              <span>{dateLabel(event.startAt).replace(/^\d+\s*/, "")}</span>
            </time>
            <span className="event-overview-name">
              <strong>{event.title}</strong>
              <small>
                {[event.venue, categoryLabel(event.category)]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
            </span>
            {score?.distanceKm !== null && score?.distanceKm !== undefined && (
              <span className="event-overview-distance">
                {score.distanceKm.toFixed(1)} km
              </span>
            )}
            {score && (
              <span className={`importance ${score.importance.toLowerCase()}`}>
                {demandLabels[score.importance]}
              </span>
            )}
            {score && (
              <strong className="event-overview-score">
                {score.total}
                <small>/100</small>
              </strong>
            )}
          </summary>
          <div className="event-overview-details">
            <EventDetails
              event={event}
              overrideImportanceAction={overrideImportanceAction}
            />
          </div>
        </details>
      );
    });

  return (
    <section className="event-overview" aria-label="Vraagmomenten met scores">
      <div className="event-overview-summary">
        <div>
          <strong>{events.length}</strong>
          <span>bevestigde vraagmomenten</span>
        </div>
        {publishableDemandLevels.map((level) => (
          <div key={level}>
            <strong>{counts[level]}</strong>
            <span>{demandLabels[level]}</span>
          </div>
        ))}
      </div>
      {!events.length && (
        <p className="empty-state">
          Geen bevestigde vraagmomenten voor deze filters.
        </p>
      )}
      <div className="event-overview-list">{rows(events)}</div>
    </section>
  );
}

export function CalendarView({
  month,
  events,
  latestRun,
  view = "list",
  overrideImportanceAction,
}: {
  month: string;
  events: CalendarEvent[];
  latestRun?: LatestRun | null;
  view?: "list" | "calendar";
  overrideImportanceAction?: (formData: FormData) => void | Promise<void>;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(events[0]?.id ?? null);
  const selectedEvent =
    events.find((event) => event.id === selectedId) ?? events[0] ?? null;

  useEffect(() => {
    if (!latestRun || latestRun.finishedAt) return;
    const timer = window.setInterval(() => router.refresh(), 3_000);
    return () => window.clearInterval(timer);
  }, [latestRun, router]);

  if (view === "list") {
    return (
      <>
        {latestRun && <RunStatus latestRun={latestRun} />}
        <EventOverview
          events={events}
          overrideImportanceAction={overrideImportanceAction}
        />
      </>
    );
  }

  const select = (eventId: string) => {
    setSelectedId(eventId);
    document
      .getElementById("event-details")
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  return (
    <>
      {latestRun && <RunStatus latestRun={latestRun} />}
      <div className="calendar-layout">
        <section className="month-panel" aria-label={`Maand ${month}`}>
          <div className="weekday-row" aria-hidden="true">
            {["ma", "di", "wo", "do", "vr", "za", "zo"].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="month-grid">
            {calendarDays(month).map((date, index) => (
              <div
                className={date ? "month-day" : "month-day empty"}
                key={date ?? `empty-${index}`}
              >
                {date && <time dateTime={date}>{Number(date.slice(-2))}</time>}
                {date &&
                  events
                    .filter(
                      (event) =>
                        event.startAt.slice(0, 10) <= date &&
                        event.endAt.slice(0, 10) >= date
                    )
                    .map((event) => {
                      const score = event.hotelScores[0];
                      return (
                        <button
                          className={`calendar-chip ${
                            score?.importance.toLowerCase() ?? ""
                          } ${
                            event.id === selectedEvent?.id ? "selected" : ""
                          }`}
                          key={event.id}
                          type="button"
                          onClick={() => select(event.id)}
                        >
                          {event.title}
                        </button>
                      );
                    })}
              </div>
            ))}
          </div>
        </section>
        <aside className="event-sidebar" aria-label="Agenda en eventdetails">
          {!events.length && (
            <p className="empty-state">
              Geen gebeurtenissen voor deze filters.
            </p>
          )}
          {events.length > 0 && (
            <div
              className="event-agenda"
              aria-label="Gebeurtenissen deze maand"
            >
              {events.map((event) => {
                const score = event.hotelScores[0];
                return (
                  <button
                    className={
                      event.id === selectedEvent?.id
                        ? "agenda-row selected"
                        : "agenda-row"
                    }
                    key={event.id}
                    type="button"
                    onClick={() => select(event.id)}
                  >
                    <time dateTime={event.startAt}>
                      {dateLabel(event.startAt)}
                    </time>
                    <span>{event.title}</span>
                    {score && (
                      <>
                        <span
                          className={`importance ${score.importance.toLowerCase()}`}
                        >
                          {demandLabels[score.importance]}
                        </span>
                        <strong className="agenda-score">{score.total}</strong>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {selectedEvent && (
            <div id="event-details">
              <EventDetails
                event={selectedEvent}
                overrideImportanceAction={overrideImportanceAction}
              />
            </div>
          )}
        </aside>
      </div>
    </>
  );
}

function RunStatus({ latestRun }: { latestRun: LatestRun }) {
  return (
    <p
      className={latestRun.hadErrors ? "updated-at warning-text" : "updated-at"}
    >
      {latestRun.finishedAt
        ? `Bijgewerkt op ${new Date(latestRun.finishedAt).toLocaleString(
            "nl-NL"
          )}${latestRun.hadErrors ? ". Een bron was niet bereikbaar." : ""}`
        : `Bijwerken gestart om ${new Date(
            latestRun.startedAt
          ).toLocaleTimeString("nl-NL", {
            hour: "2-digit",
            minute: "2-digit",
          })}.`}
    </p>
  );
}
