"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export type CalendarSource = {
  provider: string;
  url: string;
  state: string;
  primarySourceConfirmed: boolean;
};

export type CalendarHotelScore = {
  hotelId: string;
  hotelName: string;
  total: number;
  importance: "Low" | "Medium" | "High";
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
  certainty: "confirmed" | "provisional";
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
    ...Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`),
  ];
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short" }).format(new Date(value));
}

export function CalendarView({
  month,
  events,
  latestRun,
  overrideImportanceAction,
}: {
  month: string;
  events: CalendarEvent[];
  latestRun?: LatestRun | null;
  overrideImportanceAction?: (formData: FormData) => void | Promise<void>;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!latestRun || latestRun.finishedAt) return;
    const timer = window.setInterval(() => router.refresh(), 3_000);
    return () => window.clearInterval(timer);
  }, [latestRun, router]);

  return (
    <div className="calendar-layout">
      <section className="month-panel" aria-label={`Maand ${month}`}>
        <div className="weekday-row" aria-hidden="true">
          {['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'].map((day) => <span key={day}>{day}</span>)}
        </div>
        <div className="month-grid">
          {calendarDays(month).map((date, index) => (
            <div className={date ? "month-day" : "month-day empty"} key={date ?? `empty-${index}`}>
              {date && <time dateTime={date}>{Number(date.slice(-2))}</time>}
              {date && events
                .filter((event) => event.startAt.slice(0, 10) <= date && event.endAt.slice(0, 10) >= date)
                .map((event) => <span className="calendar-chip" key={event.id}>{event.title}</span>)}
            </div>
          ))}
        </div>
      </section>

      <aside className="event-list">
        {latestRun && (
          <div className="source-health">
            <strong>{latestRun.finishedAt ? "Laatst bijgewerkt" : "Gegevens worden bijgewerkt"}</strong>
            <span>
              {latestRun.finishedAt
                ? new Date(latestRun.finishedAt).toLocaleString("nl-NL")
                : `Gestart om ${new Date(latestRun.startedAt).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}. De kalender vernieuwt vanzelf.`}
            </span>
            {latestRun.hadErrors && <small>Een bron kon tijdens deze update niet worden bereikt.</small>}
          </div>
        )}
        {events.length === 0 && <p className="empty-state">Geen gebeurtenissen voor deze filters.</p>}
        {events.map((event) => (
          <article className="event-card" key={event.id}>
            <header>
              <div>
                <span className="eyebrow">{event.category}</span>
                <h2>{event.title}</h2>
              </div>
              {event.certainty === "provisional" && <span className="status provisional">Voorlopig</span>}
            </header>
            <p>{dateLabel(event.startAt)} tot {dateLabel(event.endAt)}{event.venue ? ` · ${event.venue}` : ""}</p>
            <div className="hotel-scores">
              {event.hotelScores.map((score) => (
                <section key={score.hotelId}>
                  <div><strong>{score.hotelName}</strong><span className={`importance ${score.importance.toLowerCase()}`}>{score.importance}</span></div>
                  <div className="score-total">{score.total}/100</div>
                  <small>{score.impactPoints} impact · {score.distancePoints} afstand · {score.stayPressurePoints} verblijf</small>
                  <small>Basis: {score.impactBasis}{score.distanceKm === null ? "" : ` · ${score.distanceKm.toFixed(1)} km`}</small>
                  {overrideImportanceAction && (
                    <form action={overrideImportanceAction} className="score-override">
                      <input type="hidden" name="eventId" value={event.id} />
                      <input type="hidden" name="hotelId" value={score.hotelId} />
                      <select name="importance" defaultValue={score.importance} aria-label={`Importance ${score.hotelName}`}><option>Low</option><option>Medium</option><option>High</option></select>
                      <button className="secondary" type="submit">Opslaan</button>
                    </form>
                  )}
                </section>
              ))}
            </div>
            <div className="source-links">
              {event.sources.map((source) => (
                <a href={source.url} key={`${source.provider}-${source.url}`} target="_blank" rel="noreferrer">
                  {source.provider} · {source.primarySourceConfirmed ? "bron bevestigd" : source.state}
                </a>
              ))}
            </div>
          </article>
        ))}
      </aside>
    </div>
  );
}
