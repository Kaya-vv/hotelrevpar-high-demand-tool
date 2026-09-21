-- The 21 September mail audit found these two records for the same KNZB edition.
-- Retain all records, decisions, scores, exports and sent-mail history.
update public.account_events duplicate
set state = 'excluded',
    merged_into_event_id = 'e2f00697-d9e7-4c66-be91-b5197c21dc8b',
    operator_note = concat_ws(E'\n', nullif(duplicate.operator_note, ''), 'Dubbele vermelding van NK lange baan 3–6 juni 2027; oorspronkelijke vermelding behouden.')
where duplicate.event_id = 'ded6ac76-8221-4429-9907-c3eb732ce2cf'
  and duplicate.state = 'active'
  and duplicate.merged_into_event_id is null
  and exists (
    select 1 from public.events original, public.events copy
    where original.id = 'e2f00697-d9e7-4c66-be91-b5197c21dc8b'
      and copy.id = duplicate.event_id
      and original.start_at = copy.start_at and original.end_at = copy.end_at
      and exists (
        select 1 from public.event_sources a join public.event_sources b
          on a.public_source_url = b.public_source_url
        where a.event_id = original.id and b.event_id = copy.id
          and a.public_source_url = 'https://www.knzb.nl/nieuws/wedstrijdkalender-2026-2027-bekend'
      )
  )
  and exists (
    select 1 from public.account_events original
    where original.account_id = duplicate.account_id
      and original.event_id = 'e2f00697-d9e7-4c66-be91-b5197c21dc8b'
      and original.state = 'active' and original.merged_into_event_id is null
  )
  and not exists (
    select 1 from public.account_event_areas link
    where link.account_id = duplicate.account_id and link.event_id = duplicate.event_id
      and not exists (
        select 1 from public.account_event_areas original
        where original.collection_area_id = link.collection_area_id
          and original.account_id = link.account_id
          and original.event_id = 'e2f00697-d9e7-4c66-be91-b5197c21dc8b'
      )
  )
  and not exists (
    select 1 from public.hotel_event_scores score join public.hotels hotel on hotel.id = score.hotel_id
    where hotel.account_id = duplicate.account_id and score.event_id = duplicate.event_id
      and score.importance_override is not null
  );

update public.event_notification_items item
set suppressed = true
where item.event_id = 'ded6ac76-8221-4429-9907-c3eb732ce2cf'
  and exists (
    select 1 from public.account_events decision
    where decision.account_id = item.account_id and decision.event_id = item.event_id
      and decision.merged_into_event_id = 'e2f00697-d9e7-4c66-be91-b5197c21dc8b'
  );
