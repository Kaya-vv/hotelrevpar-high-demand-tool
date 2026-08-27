drop policy "members create their account events" on account_events;
drop policy "members delete their account events" on account_events;

revoke insert, delete, update on account_events from authenticated;
grant update (
  state,
  review_reason,
  operator_note,
  override_title,
  override_start_at,
  override_end_at,
  override_venue,
  merged_into_event_id,
  decided_at,
  decided_by
) on account_events to authenticated;

revoke update on hotel_event_scores from authenticated;
grant update (importance_override, override_note) on hotel_event_scores to authenticated;

