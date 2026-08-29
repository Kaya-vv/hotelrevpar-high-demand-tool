import { getReviewData } from "@/features/calendar/query";
import {
  acceptEvent,
  applyReviewChange,
  editEvent,
  excludeEvent,
  keepCurrentEvent,
  mergeEvent,
} from "@/features/review/actions";
import { ReviewList } from "@/features/review/review-list";
import { requirePlatformAdmin } from "@/lib/auth/require-account";

export default async function ReviewPage() {
  const { accountId } = await requirePlatformAdmin();
  const data = await getReviewData(accountId);
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
