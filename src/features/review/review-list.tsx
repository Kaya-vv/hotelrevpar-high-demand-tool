import type { CalendarSource } from "@/features/calendar/calendar-view";

type EventVersion = {
  title: string;
  venue: string | null;
  startAt: string;
  endAt: string;
};

export type ReviewEvent = EventVersion & {
  id: string;
  reviewReason: string | null;
  proposed: EventVersion | null;
  target: EventVersion | null;
  sources: CalendarSource[];
};

type Action = (formData: FormData) => void | Promise<void>;
export type ReviewActions = {
  accept: Action;
  keepCurrent: Action;
  applyChange: Action;
  edit: Action;
  exclude: Action;
  merge: Action;
};

const reasons: Record<string, string> = {
  duplicate_uncertain: "Mogelijk hetzelfde evenement",
  date_conflict: "Datums spreken elkaar tegen",
  changed_date: "Datum gewijzigd",
  changed_venue: "Locatie gewijzigd",
  cancelled: "Evenement geannuleerd",
  postponed: "Evenement uitgesteld",
};

function date(value: string) {
  return new Intl.DateTimeFormat("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function Version({ title, event }: { title: string; event: EventVersion }) {
  return (
    <section className="review-version">
      <span className="eyebrow">{title}</span>
      <strong>{event.title}</strong>
      <span>
        {date(event.startAt)} tot {date(event.endAt)}
      </span>
      {event.venue && <span>{event.venue}</span>}
    </section>
  );
}

function ActionForm({
  eventId,
  action,
  label,
  primary = false,
}: {
  eventId: string;
  action: Action;
  label: string;
  primary?: boolean;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="eventId" value={eventId} />
      <button className={primary ? "primary" : "secondary"} type="submit">
        {label}
      </button>
    </form>
  );
}

export function ReviewList({
  events,
  actions,
}: {
  events: ReviewEvent[];
  actions: ReviewActions;
}) {
  if (!events.length)
    return <p className="empty-state">Geen uitzonderingen voor dit hotel.</p>;

  return (
    <div className="review-list">
      {events.map((event) => {
        const current: EventVersion = {
          title: event.title,
          venue: event.venue,
          startAt: event.startAt,
          endAt: event.endAt,
        };
        const reason = event.reviewReason ?? "";
        return (
          <article className="review-card" key={event.id}>
            <header>
              <div>
                <span className="status review">
                  {reasons[reason] ?? "Controle nodig"}
                </span>
                <h2>{event.title}</h2>
              </div>
              <span>{date(event.startAt)}</span>
            </header>

            {reason === "duplicate_uncertain" && event.target && (
              <div className="review-comparison">
                <Version title="Gevonden" event={current} />
                <Version title="Bestaand event" event={event.target} />
              </div>
            )}
            {[
              "date_conflict",
              "changed_date",
              "changed_venue",
              "postponed",
            ].includes(reason) &&
              event.proposed && (
                <div className="review-comparison">
                  <Version title="Huidig" event={current} />
                  <Version title="Nieuwe informatie" event={event.proposed} />
                </div>
              )}
            {reason === "cancelled" && (
              <p>
                De bron meldt dat dit evenement is geannuleerd. Kies of het uit
                de kalender moet.
              </p>
            )}

            <div className="review-actions">
              {reason === "duplicate_uncertain" && event.target ? (
                <>
                  <ActionForm
                    eventId={event.id}
                    action={actions.merge}
                    label="Zelfde evenement"
                    primary
                  />
                  <ActionForm
                    eventId={event.id}
                    action={actions.accept}
                    label="Apart behouden"
                  />
                </>
              ) : [
                  "date_conflict",
                  "changed_date",
                  "changed_venue",
                  "postponed",
                ].includes(reason) && event.proposed ? (
                <>
                  <ActionForm
                    eventId={event.id}
                    action={actions.applyChange}
                    label="Wijziging overnemen"
                    primary
                  />
                  <ActionForm
                    eventId={event.id}
                    action={actions.keepCurrent}
                    label="Huidige gegevens behouden"
                  />
                </>
              ) : reason === "cancelled" ? (
                <>
                  <ActionForm
                    eventId={event.id}
                    action={actions.exclude}
                    label="Uit kalender verwijderen"
                    primary
                  />
                  <ActionForm
                    eventId={event.id}
                    action={actions.accept}
                    label="Behouden"
                  />
                </>
              ) : (
                <>
                  <ActionForm
                    eventId={event.id}
                    action={actions.accept}
                    label="Behouden"
                    primary
                  />
                  <ActionForm
                    eventId={event.id}
                    action={actions.exclude}
                    label="Uitsluiten"
                  />
                </>
              )}
            </div>

            <details className="review-more">
              <summary>Bron en eventgegevens</summary>
              <div className="source-links">
                {event.sources
                  .filter((source) => source.url)
                  .map((source) => (
                    <a
                      href={source.url!}
                      key={`${source.provider}-${source.url}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Bekijk bron ({source.provider})
                    </a>
                  ))}
              </div>
              <form action={actions.edit} className="form-grid compact">
                <input type="hidden" name="eventId" value={event.id} />
                <label>
                  Titel
                  <input name="title" defaultValue={event.title} required />
                </label>
                <label>
                  Locatie
                  <input name="venue" defaultValue={event.venue ?? ""} />
                </label>
                <label>
                  Start
                  <input
                    name="startAt"
                    type="datetime-local"
                    defaultValue={event.startAt.slice(0, 16)}
                    required
                  />
                </label>
                <label>
                  Einde
                  <input
                    name="endAt"
                    type="datetime-local"
                    defaultValue={event.endAt.slice(0, 16)}
                    required
                  />
                </label>
                <label className="wide">
                  Notitie
                  <input name="note" />
                </label>
                <button className="secondary" type="submit">
                  Bewerking opslaan
                </button>
              </form>
            </details>
          </article>
        );
      })}
    </div>
  );
}
