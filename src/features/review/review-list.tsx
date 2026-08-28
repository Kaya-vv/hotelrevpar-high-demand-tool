import type { CalendarSource } from "@/features/calendar/calendar-view";

export type ReviewEvent = {
  id: string;
  title: string;
  venue: string | null;
  startAt: string;
  endAt: string;
  reviewReason: string | null;
  sources: CalendarSource[];
};

type Action = (formData: FormData) => void | Promise<void>;
export type ReviewActions = { accept: Action; edit: Action; exclude: Action; merge: Action };

const reasons: Record<string, string> = {
  missing_source: "Controleerbare eventpagina ontbreekt",
  missing_fields: "Titel, datum of locatie ontbreekt",
  duplicate_uncertain: "Mogelijk duplicaat",
  date_conflict: "Datumconflict",
  changed_date: "Datum gewijzigd",
  changed_venue: "Locatie gewijzigd",
  cancelled: "Geannuleerd",
  postponed: "Uitgesteld",
  missing_primary_evidence: "Organisator, datum of locatie kon niet worden bevestigd",
};

export function ReviewList({ events, actions }: { events: ReviewEvent[]; actions: ReviewActions }) {
  if (!events.length) return <p className="empty-state">Geen gebeurtenissen te beoordelen.</p>;

  return (
    <div className="review-list">
      {events.map((event) => (
        <article className="review-card" key={event.id}>
          <header>
            <div><span className="status review">{reasons[event.reviewReason ?? ""] ?? event.reviewReason}</span><h2>{event.title}</h2></div>
            <span>{event.startAt.slice(0, 10)}{event.venue ? ` · ${event.venue}` : ""}</span>
          </header>
          <div className="source-links">
            {event.sources.map((source) => <a href={source.url} key={source.url} target="_blank" rel="noreferrer">{source.provider} · {source.primarySourceConfirmed ? "bron bevestigd" : "bewijs controleren"}</a>)}
          </div>
          <div className="review-actions">
            <form action={actions.accept}><input type="hidden" name="eventId" value={event.id} /><button className="primary" type="submit">Accepteren</button></form>
            <details>
              <summary>Bewerken</summary>
              <form action={actions.edit} className="form-grid compact">
                <input type="hidden" name="eventId" value={event.id} />
                <label>Titel<input name="title" defaultValue={event.title} required /></label>
                <label>Locatie<input name="venue" defaultValue={event.venue ?? ""} /></label>
                <label>Start<input name="startAt" type="datetime-local" defaultValue={event.startAt.slice(0, 16)} required /></label>
                <label>Einde<input name="endAt" type="datetime-local" defaultValue={event.endAt.slice(0, 16)} required /></label>
                <label className="wide">Notitie<input name="note" /></label>
                <button className="secondary" type="submit">Bewerken</button>
              </form>
            </details>
            <form action={actions.exclude}><input type="hidden" name="eventId" value={event.id} /><input name="note" aria-label="Notitie uitsluiten" placeholder="Reden" /><button className="secondary" type="submit">Uitsluiten</button></form>
            <form action={actions.merge}><input type="hidden" name="eventId" value={event.id} /><input name="targetEventId" aria-label="Doel-event-ID" placeholder="Doel-event-ID" required /><button className="secondary" type="submit">Samenvoegen</button></form>
          </div>
        </article>
      ))}
    </div>
  );
}

