import { stopViewingOtherAccount } from "./actions";

/**
 * Shown instead of a page that only works with your own hotels, while the platform
 * administrator is looking at a subscriber's hotel. Looking at a subscriber never changes
 * their data, so pages with buttons that save something stay closed.
 */
export function OwnAccountOnly({
  accountName,
  page,
}: {
  accountName: string;
  page: string;
}) {
  return (
    <div>
      <header className="page-title">
        <span className="eyebrow">Meekijken</span>
        <h1>{page}</h1>
        <p>
          Je kijkt mee in het account van {accountName}. Daar kun je alleen de
          kalender bekijken. Deze pagina werkt met je eigen hotels.
        </p>
      </header>
      <form action={stopViewingOtherAccount}>
        <button className="primary" type="submit">
          Terug naar mijn eigen hotels
        </button>
      </form>
    </div>
  );
}
