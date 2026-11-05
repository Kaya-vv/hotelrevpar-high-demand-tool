-- The manual review queue is gone. Nobody ever worked it, so every event in it stayed off the
-- hotels' calendars. A probable copy of an event already shown stays out automatically, as the
-- collection now does itself; everything else returns to the calendar.
update account_events
set state = 'excluded',
    automation_reason = 'duplicate_uncertain',
    decided_at = now(),
    decided_by = null
where state = 'needs_review'
  and review_reason = 'duplicate_uncertain';

update account_events
set state = 'active',
    automation_reason = null,
    decided_at = now(),
    decided_by = null
where state = 'needs_review';

-- Nothing reads or writes these any more.
update account_events
set review_reason = null,
    review_target_event_id = null,
    review_source_id = null,
    review_fingerprint = null,
    resolved_review_fingerprint = null
where review_reason is not null
   or review_target_event_id is not null
   or review_source_id is not null
   or review_fingerprint is not null
   or resolved_review_fingerprint is not null;

-- The address queue for events without a map location had no page left to show it.
drop table unresolved_event_locations;
