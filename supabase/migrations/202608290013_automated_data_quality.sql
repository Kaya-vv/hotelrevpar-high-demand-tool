alter table event_sources
  add column public_source_url text,
  add column provider_duplicate_of_id text,
  add column provider_deleted_reason text,
  add column provider_cancelled_at timestamptz,
  add column provider_postponed_at timestamptz;

alter table account_events
  add column automation_reason text;

update event_sources
set public_source_url = source_url
where primary_source_confirmed
  and provider <> 'predicthq'
  and source_url not like 'https://api.predicthq.com/%';

update event_sources
set primary_source_confirmed = false
where public_source_url is null;

update account_events
set state = 'excluded',
    automation_reason = case review_reason
      when 'duplicate_uncertain' then 'duplicate_quarantined'
      when 'cancelled' then 'provider_cancelled'
      when 'postponed' then 'provider_postponed'
      else review_reason
    end,
    merged_into_event_id = coalesce(merged_into_event_id, review_target_event_id),
    resolved_review_fingerprint = coalesce(resolved_review_fingerprint, review_fingerprint),
    review_reason = null,
    decided_at = now(),
    decided_by = null
where state = 'needs_review'
  and review_reason in ('duplicate_uncertain', 'cancelled', 'postponed');

update account_events as decision
set state = 'active',
    automation_reason = null,
    resolved_review_fingerprint = coalesce(decision.resolved_review_fingerprint, decision.review_fingerprint),
    review_reason = null,
    decided_at = now(),
    decided_by = null
where decision.state = 'needs_review'
  and decision.review_reason in ('changed_date', 'changed_venue', 'date_conflict')
  and exists (
    select 1
    from event_sources as source
    where source.event_id = decision.event_id
      and source.provider in ('rijksoverheid', 'openholidays', 'ticketmaster', 'predicthq')
  );
