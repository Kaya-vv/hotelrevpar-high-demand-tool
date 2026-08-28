import { getReviewData } from "@/features/calendar/query";
import { acceptEvent, editEvent, excludeEvent, mergeEvent } from "@/features/review/actions";
import { ReviewList } from "@/features/review/review-list";
import { requireAccount } from "@/lib/auth/require-account";

function value(params: Record<string, string | string[] | undefined>, key: string) {
  const item = params[key];
  return typeof item === "string" ? item : undefined;
}

export default async function ReviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { accountId } = await requireAccount();
  const params = await searchParams;
  const data = await getReviewData(accountId, value(params, "hotel"));
  return (
    <div>
      <header className="page-title"><span className="eyebrow">Uitzonderingen</span><h1>Te beoordelen</h1><p>Controleer mogelijke duplicaten, wijzigingen, annuleringen en uitstel.</p></header>
      <form className="hotel-filter">
        <label>Hotel<select name="hotel" defaultValue={data.selectedHotelId ?? ""}>{data.hotels.map((hotel) => <option key={hotel.id} value={hotel.id}>{hotel.name}</option>)}</select></label>
        <button className="secondary" type="submit">Tonen</button>
      </form>
      <ReviewList events={data.events} actions={{ accept: acceptEvent, edit: editEvent, exclude: excludeEvent, merge: mergeEvent }} />
    </div>
  );
}

