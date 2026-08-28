delete from hotel_event_scores as score
where not exists (
  select 1
  from hotels as hotel
  join collection_areas as area on area.hotel_id = hotel.id
  join account_event_areas as link
    on link.account_id = hotel.account_id
   and link.collection_area_id = area.id
   and link.event_id = score.event_id
  where hotel.id = score.hotel_id
);

delete from account_event_areas as link
using collection_areas as area, hotels as hotel, events as event
where link.collection_area_id = area.id
  and area.hotel_id = hotel.id
  and link.event_id = event.id
  and event.category = 'school_holiday'
  and event.region_scope is distinct from hotel.holiday_region;

update account_events
set state = 'excluded'
where state = 'needs_review'
  and review_reason in ('missing_source', 'missing_fields', 'missing_primary_evidence');
