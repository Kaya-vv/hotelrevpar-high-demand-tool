import { getReviewData } from "@/features/calendar/query";
import { unresolvedEventLocations } from "@/features/collection/unresolved-locations";
import {
  acceptEvent,
  applyReviewChange,
  editEvent,
  excludeEvent,
  keepCurrentEvent,
  mergeEvent,
} from "@/features/review/actions";
import {
  dismissEventLocation,
  resolveEventLocation,
} from "@/features/review/location-actions";
import { UnresolvedLocationsList } from "@/features/review/unresolved-locations-list";
import { ReviewList } from "@/features/review/review-list";
import { requireViewedAccount } from "@/features/workspace/viewed-account";
import { OwnAccountOnly } from "@/features/workspace/viewing-notice";
import { requirePlatformAdmin } from "@/lib/auth/require-account";

export default async function ReviewPage() {
  const { accountId } = await requirePlatformAdmin();
  const { viewedAccountName, viewingOtherAccount } = await requireViewedAccount();
  if (viewingOtherAccount)
    return <OwnAccountOnly accountName={viewedAccountName} page="Datakwaliteit" />;
  const [data, unresolvedLocations] = await Promise.all([
    getReviewData(accountId),
    unresolvedEventLocations(accountId),
  ]);
  const selectedHotel = data.hotels.find(
    (hotel) => hotel.id === data.selectedHotelId
  );
  return (
    <div>
      <header className="page-title">
        <span className="eyebrow">Platformbeheer</span>
        <h1>Datakwaliteit · {selectedHotel?.name ?? "Hotel"}</h1>
        <p>
          Alleen bronconflicten die de app niet veilig kan oplossen verschijnen
          hier. Hotelmanagers zien deze interne wachtrij niet.
        </p>
      </header>
      {unresolvedLocations.length > 0 && (
        <section>
          <header className="page-title">
            <span className="eyebrow">Locatie aanvullen</span>
            <h2>Evenementen zonder kaartlocatie</h2>
            <p>
              Deze evenementen zijn wel gevonden, maar konden niet op de kaart
              worden gezet. Ze staan daarom nog op geen enkele kalender. Vul
              het adres in om ze door de gewone controle en score te halen.
            </p>
          </header>
          <UnresolvedLocationsList
            items={unresolvedLocations}
            actions={{
              resolve: resolveEventLocation,
              dismiss: dismissEventLocation,
            }}
          />
        </section>
      )}
      <ReviewList
        events={data.events}
        actions={{
          accept: acceptEvent,
          keepCurrent: keepCurrentEvent,
          applyChange: applyReviewChange,
          edit: editEvent,
          exclude: excludeEvent,
          merge: mergeEvent,
        }}
      />
    </div>
  );
}
