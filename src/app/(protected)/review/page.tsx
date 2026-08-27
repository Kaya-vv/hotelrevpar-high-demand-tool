import { getReviewEvents } from "@/features/calendar/query";
import { acceptEvent, editEvent, excludeEvent, mergeEvent } from "@/features/review/actions";
import { ReviewList } from "@/features/review/review-list";
import { requireAccount } from "@/lib/auth/require-account";

export default async function ReviewPage() {
  const { accountId } = await requireAccount();
  const events = await getReviewEvents(accountId);
  return (
    <div>
      <header className="page-title"><span className="eyebrow">Uitzonderingen</span><h1>Te beoordelen</h1><p>Controleer conflicten, wijzigingen en bronnen zonder bevestigd bewijs.</p></header>
      <ReviewList events={events} actions={{ accept: acceptEvent, edit: editEvent, exclude: excludeEvent, merge: mergeEvent }} />
    </div>
  );
}

