-- Which events an account sends to RevControl, in the Excel export and through the API: from
-- Medium up (the default), only High and Peak, or also the hidden Laag tier.
alter table public.accounts add column export_min_level text not null default 'Medium'
  check (export_min_level in ('Low', 'Medium', 'High'));

-- The export screen no longer sets a level of its own: the calendar's level is the only one. Levels
-- that managers picked in earlier exports move to the calendar, so what they sent stays the same.
update public.hotel_event_scores hs
set importance_override = c.importance, override_note = 'Niveau uit een eerdere Excel-export'
from public.announcement_export_choices c
where hs.hotel_id = c.hotel_id and hs.event_id = c.event_id
  and c.importance in ('Low', 'High', 'Peak')
  and hs.importance_override is null
  and hs.suggested_importance <> c.importance;

-- The commit without export-only levels. The old version with p_choices stays until the code that
-- calls it is replaced; 202611030003 removes it.
create function public.commit_hotel_export(p_account uuid, p_user uuid, p_key uuid, p_hash text,
  p_selection jsonb, p_workbook text, p_items jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare b uuid; old_hash text; item jsonb; h uuid;
begin
  if not exists(select 1 from account_members m join accounts a on a.id=m.account_id
    where m.account_id=p_account and m.user_id=p_user and a.active) then
    raise exception 'Export account access denied' using errcode='42501';
  end if;
  -- Account lock also serializes confirmed identity transfers with export creation.
  perform 1 from accounts where id=p_account for update;
  select id, request_hash into b, old_hash from export_batches where account_id=p_account and request_key=p_key;
  if b is not null then
    if old_hash<>p_hash then raise exception 'Export request key reused' using errcode='P0001'; end if;
    return b;
  end if;
  if jsonb_array_length(p_items)=0 or p_selection->>'mode' not in ('new','selected','all') then
    raise exception 'Empty or invalid export';
  end if;
  for item in select value from jsonb_array_elements(p_items) loop
    h := (item->>'hotelId')::uuid;
    if not exists(select 1 from hotels where id=h and account_id=p_account)
      or not exists(select 1 from account_events where account_id=p_account and event_id=(item->>'eventId')::uuid and state='active' and merged_into_event_id is null)
      then raise exception 'Invalid export ownership or stale event' using errcode='42501'; end if;
    if p_selection->>'mode'='new' and exists(select 1 from hotel_event_exports where hotel_id=h and event_id=(item->>'eventId')::uuid) then
      raise exception 'Export selection changed' using errcode='P0001';
    end if;
    -- Collection or an operator may have changed the event while XLSX was built.
    if not exists(
      select 1 from events e join account_events ae on ae.event_id=e.id and ae.account_id=p_account
      join hotels ht on ht.id=h
      join hotel_event_scores hs on hs.event_id=e.id and hs.hotel_id=h
      where e.id=(item->>'eventId')::uuid and e.certainty='confirmed' and e.source_state='active'
        and coalesce(ae.override_title,e.title)=item->>'title'
        and event_local_date(coalesce(ae.override_start_at,e.start_at))=item->>'startDate'
        and event_local_date(coalesce(ae.override_end_at,e.end_at))=item->>'endDate'
        and ht.revcontrol_code=item->>'hotelCode'
        -- Only a source arguing against hotel demand blocks an export.
        and coalesce(hs.demand_assessment->>'relevance','unresolved') <> 'not_relevant'
        and ((item->>'manual')::boolean
          or ((hs.importance_override is not null or hs.impact_basis <> 'default')
            and coalesce(hs.importance_override,hs.suggested_importance) in ('High','Peak') and item->>'importance'='High'))
        and exists(select 1 from account_event_areas links join collection_areas ca on ca.id=links.collection_area_id
          join event_sources es on es.event_id=links.event_id
          where links.account_id=p_account and links.event_id=e.id and ca.hotel_id=h
            and es.provider=any(ca.enabled_sources) and es.source_state='active' and es.primary_source_confirmed and es.public_source_url is not null)
    ) then raise exception 'Export event changed during generation' using errcode='P0001'; end if;
  end loop;
  insert into export_batches(account_id,created_by,request_key,request_hash,selection,workbook)
    values(p_account,p_user,p_key,p_hash,p_selection,decode(p_workbook,'base64')) returning id into b;
  for item in select value from jsonb_array_elements(p_items) loop
    insert into export_items values(b,p_account,(item->>'hotelId')::uuid,(item->>'eventId')::uuid,item);
    insert into hotel_event_exports values(p_account,(item->>'hotelId')::uuid,(item->>'eventId')::uuid,(item->>'eventId')::uuid,(item->>'eventId')::uuid,b,b)
      on conflict(hotel_id,event_id) do update set latest_batch_id=b, latest_item_event_id=(item->>'eventId')::uuid;
  end loop;
  return b;
end $$;
revoke all on function public.commit_hotel_export(uuid,uuid,uuid,text,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.commit_hotel_export(uuid,uuid,uuid,text,jsonb,text,jsonb) to service_role;
