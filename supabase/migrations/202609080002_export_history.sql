-- Workbooks and their first-export claims commit together. A download never writes.
create table public.export_batches (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts on delete cascade,
  created_by uuid not null references auth.users,
  created_at timestamptz not null default now(),
  request_key uuid not null,
  request_hash text not null,
  selection jsonb not null,
  workbook bytea not null,
  unique(account_id, request_key)
);
create table public.export_items (
  batch_id uuid not null references public.export_batches on delete cascade,
  account_id uuid not null references public.accounts on delete cascade,
  hotel_id uuid not null references public.hotels on delete cascade,
  event_id uuid not null references public.events,
  snapshot jsonb not null,
  primary key(batch_id, hotel_id, event_id)
);
-- Identity is mutable; historical item snapshots and workbook bytes are not.
create table public.hotel_event_exports (
  account_id uuid not null references public.accounts on delete cascade,
  hotel_id uuid not null references public.hotels on delete cascade,
  event_id uuid not null references public.events,
  canonical_event_id uuid not null references public.events,
  latest_item_event_id uuid not null references public.events,
  first_batch_id uuid not null references public.export_batches,
  latest_batch_id uuid not null references public.export_batches,
  primary key(hotel_id, event_id)
);
create table public.announcement_export_choices (
  account_id uuid not null references public.accounts on delete cascade,
  hotel_id uuid not null references public.hotels on delete cascade,
  event_id uuid not null references public.events,
  importance text not null check(importance in ('Low','Medium','High','Peak')),
  primary key(hotel_id, event_id)
);
alter table public.export_batches enable row level security;
alter table public.export_items enable row level security;
alter table public.hotel_event_exports enable row level security;
alter table public.announcement_export_choices enable row level security;
create policy "members read export batches" on public.export_batches for select to authenticated using(public.is_account_member(account_id));
create policy "members read export items" on public.export_items for select to authenticated using(public.is_account_member(account_id));
create policy "members read export claims" on public.hotel_event_exports for select to authenticated using(public.is_account_member(account_id));
create policy "members read export choices" on public.announcement_export_choices for select to authenticated using(public.is_account_member(account_id));
revoke all on public.export_batches, public.export_items, public.hotel_event_exports, public.announcement_export_choices from anon, authenticated;
grant select on public.export_batches, public.export_items, public.hotel_event_exports, public.announcement_export_choices to authenticated;
grant all on public.export_batches, public.export_items, public.hotel_event_exports, public.announcement_export_choices to service_role;

-- Called only by the authenticated server after shared eligibility validation and XLSX
-- generation. Membership is checked again here; clients cannot submit workbook claims.
create function public.commit_hotel_export(p_account uuid, p_user uuid, p_key uuid, p_hash text,
  p_selection jsonb, p_workbook text, p_items jsonb, p_choices jsonb)
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
        and to_char(coalesce(ae.override_start_at,e.start_at) at time zone 'Europe/Amsterdam','YYYY-MM-DD')=item->>'startDate'
        and to_char(coalesce(ae.override_end_at,e.end_at) at time zone 'Europe/Amsterdam','YYYY-MM-DD')=item->>'endDate'
        and ht.revcontrol_code=item->>'hotelCode'
        and ((item->>'manual')::boolean or (hs.impact_basis<>'default'
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
  for item in select value from jsonb_array_elements(p_choices) loop
    if not exists(select 1 from export_items where batch_id=b and hotel_id=(item->>'hotelId')::uuid and event_id=(item->>'eventId')::uuid) then
      raise exception 'Choice is not part of export';
    end if;
    insert into announcement_export_choices values(p_account,(item->>'hotelId')::uuid,(item->>'eventId')::uuid,item->>'importance')
      on conflict(hotel_id,event_id) do update set importance=excluded.importance;
  end loop;
  return b;
end $$;
revoke all on function public.commit_hotel_export(uuid,uuid,uuid,text,jsonb,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.commit_hotel_export(uuid,uuid,uuid,text,jsonb,text,jsonb,jsonb) to service_role;

create function public.transfer_export_identity(p_account uuid,p_old uuid,p_new uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if p_old=p_new then return; end if;
  perform 1 from accounts where id=p_account for update;
  insert into hotel_event_exports(account_id,hotel_id,event_id,canonical_event_id,latest_item_event_id,first_batch_id,latest_batch_id)
    select account_id,hotel_id,p_new,p_new,latest_item_event_id,first_batch_id,latest_batch_id from hotel_event_exports where account_id=p_account and event_id=p_old
    on conflict(hotel_id,event_id) do update set
      latest_item_event_id=case when (select (created_at,id) from export_batches where id=excluded.latest_batch_id) > (select (created_at,id) from export_batches where id=hotel_event_exports.latest_batch_id) then excluded.latest_item_event_id else hotel_event_exports.latest_item_event_id end,
      first_batch_id=(select id from export_batches where id in (hotel_event_exports.first_batch_id,excluded.first_batch_id) order by created_at,id limit 1),
      latest_batch_id=(select id from export_batches where id in (hotel_event_exports.latest_batch_id,excluded.latest_batch_id) order by created_at desc,id desc limit 1);
  insert into announcement_export_choices
    select account_id,hotel_id,p_new,importance from announcement_export_choices where account_id=p_account and event_id=p_old
    on conflict(hotel_id,event_id) do nothing;
  update hotel_event_exports set canonical_event_id=p_new where account_id=p_account and canonical_event_id=p_old;
  -- Retain the old claim too: a stale source must not make either identity look new.
end $$;
revoke all on function public.transfer_export_identity(uuid,uuid,uuid) from public,anon,authenticated;

create function public.export_identity_after_manual_merge() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.merged_into_event_id is not null and new.merged_into_event_id is distinct from old.merged_into_event_id then
    if not exists(select 1 from account_events where account_id=new.account_id and event_id=new.merged_into_event_id) then
      raise exception 'Merge target outside account';
    end if;
    perform transfer_export_identity(new.account_id,new.event_id,new.merged_into_event_id);
  end if;
  return new;
end $$;
create trigger export_identity_manual after update of merged_into_event_id on public.account_events
  for each row execute function public.export_identity_after_manual_merge();

create function public.export_identity_after_source_move() returns trigger language plpgsql security definer set search_path=public as $$
declare a uuid;
begin
  if new.event_id<>old.event_id then
    for a in select distinct account_id from hotel_event_exports where event_id=old.event_id order by account_id loop
      perform transfer_export_identity(a,old.event_id,new.event_id);
    end loop;
  end if;
  return new;
end $$;
create trigger export_identity_source after update of event_id on public.event_sources
  for each row execute function public.export_identity_after_source_move();
