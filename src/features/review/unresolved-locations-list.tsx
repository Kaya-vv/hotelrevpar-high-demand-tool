import type { UnresolvedLocation } from "@/features/collection/unresolved-locations";

type Action = (formData: FormData) => Promise<void>;

type UnresolvedLocationsListProps = {
  items: UnresolvedLocation[];
  actions: {
    resolve: Action;
    dismiss: Action;
  };
};

function date(value: string) {
  return new Intl.DateTimeFormat("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function IdentityFields({ item }: { item: UnresolvedLocation }) {
  return (
    <>
      <input type="hidden" name="areaId" value={item.areaId} />
      <input type="hidden" name="provider" value={item.provider} />
      <input
        type="hidden"
        name="providerEventId"
        value={item.providerEventId}
      />
    </>
  );
}

export function UnresolvedLocationsList({
  items,
  actions,
}: UnresolvedLocationsListProps) {
  if (!items.length) return null;

  return (
    <div className="review-list">
      {items.map((item) => (
        <article
          className="review-card"
          key={`${item.areaId}-${item.provider}-${item.providerEventId}`}
        >
          <header>
            <div>
              <span className="status review">
                {item.horizon === "near_term"
                  ? "90-dagenzoektocht"
                  : "Zoektocht voor komend jaar"}
              </span>
              <h2>{item.title}</h2>
            </div>
            <span>
              {date(item.startDate)} tot {date(item.endDate)}
            </span>
          </header>

          <section className="review-version">
            <span className="eyebrow">Gebied</span>
            <strong>{item.areaName}</strong>
            <span>
              Gevonden locatie: {item.venue ?? "geen locatie gevonden"}
            </span>
            {item.locationText && (
              <blockquote>&ldquo;{item.locationText}&rdquo;</blockquote>
            )}
            {item.hostCity && <span>Plaats: {item.hostCity}</span>}
            {item.sourceUrl && (
              <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                Bekijk bron
              </a>
            )}
          </section>

          <form action={actions.resolve} className="form-grid compact">
            <IdentityFields item={item} />
            <label className="wide">
              Adres
              <input
                name="address"
                placeholder="Straat 10, Eindhoven"
                required
              />
            </label>
            <button className="primary" type="submit">
              Adres opslaan
            </button>
          </form>

          <div className="review-actions">
            <form action={actions.dismiss}>
              <IdentityFields item={item} />
              <button className="secondary" type="submit">
                Niet gebruiken
              </button>
            </form>
          </div>
        </article>
      ))}
    </div>
  );
}
