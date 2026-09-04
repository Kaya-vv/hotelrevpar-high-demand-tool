begin;

do $$
declare
  v_account_id uuid := '1a6faa35-b32a-4c18-8681-b0d9bd9e4c88';
  v_hotel_id uuid := '4b8f4557-c84b-4516-8cf6-0aa0838e71fc';
  v_digimarcon_canonical uuid := 'b075efd5-1a4f-4c84-8d93-fb6eddd447ef';
  v_marathon_canonical uuid := '31ec5750-742f-4a1e-bd24-142919b701f3';
begin
  -- Keep the Amsterdam-specific official record and retain all source evidence on it.
  update event_sources
  set event_id = v_digimarcon_canonical
  where event_id in (
    'a839d241-359a-4075-8771-96302ea7a204',
    '18a6da29-708d-4aff-8607-eed802f9bc63'
  )
  and not exists (
    select 1
    from event_sources existing
    where existing.event_id = v_digimarcon_canonical
      and existing.provider = event_sources.provider
      and existing.provider_event_id = event_sources.provider_event_id
  );

  update account_events as ae
  set state = 'excluded',
      merged_into_event_id = v_digimarcon_canonical,
      operator_note = 'Handmatig samengevoegd met DigiMarCon Amsterdam 2026.',
      decided_at = now()
  where ae.account_id = v_account_id
    and ae.event_id in (
      'a839d241-359a-4075-8771-96302ea7a204',
      '18a6da29-708d-4aff-8607-eed802f9bc63'
    );

  -- Keep the event carrying the official multi-day programme (15-18 October).
  update event_sources
  set event_id = v_marathon_canonical
  where event_id in (
    '7de0f7f8-3fcb-4bb8-857c-299ae29c02e8',
    '730e3fa4-5474-4283-aa80-b53aed8d0c10'
  )
  and not exists (
    select 1
    from event_sources existing
    where existing.event_id = v_marathon_canonical
      and existing.provider = event_sources.provider
      and existing.provider_event_id = event_sources.provider_event_id
  );

  update account_events as ae
  set state = 'excluded',
      merged_into_event_id = v_marathon_canonical,
      operator_note = 'Handmatig samengevoegd met het volledige TCS Amsterdam Marathon-programma.',
      decided_at = now()
  where ae.account_id = v_account_id
    and ae.event_id in (
      '7de0f7f8-3fcb-4bb8-857c-299ae29c02e8',
      '730e3fa4-5474-4283-aa80-b53aed8d0c10'
    );

  -- These records should remain auditable but should not appear as High/Peak output.
  update hotel_event_scores
  set importance_override = 'Medium',
      override_note = 'Handmatig verborgen: terugkerende theatervoorstelling zonder geconcentreerde hotelvraag.'
  where hotel_event_scores.hotel_id = v_hotel_id
    and hotel_event_scores.event_id = '33a9d5c9-0c2f-4293-a029-062c832d1981';

  update hotel_event_scores
  set importance_override = 'Medium',
      override_note = 'Handmatig verborgen: alleen aggregator-bron, geen geaccepteerde officiële eventpagina.'
  where hotel_event_scores.hotel_id = v_hotel_id
    and hotel_event_scores.event_id = 'ca82ab95-089f-4538-9d4f-a67630460daf';
end $$;

commit;
