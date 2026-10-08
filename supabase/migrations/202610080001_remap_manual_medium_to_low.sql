-- Hand-set Medium used to mean hidden; it now means shown, so preserve existing hidden choices as Low.
update public.hotel_event_scores
set importance_override = 'Low'
where importance_override = 'Medium';
