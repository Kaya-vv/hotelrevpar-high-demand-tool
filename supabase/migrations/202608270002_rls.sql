create or replace function is_account_member(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from account_members
    join accounts on accounts.id = account_members.account_id
    where account_members.account_id = target
      and account_members.user_id = auth.uid()
      and accounts.active
  );
$$;

revoke all on function is_account_member(uuid) from public;
grant execute on function is_account_member(uuid) to authenticated;

alter table accounts enable row level security;
alter table account_members enable row level security;
alter table hotels enable row level security;
alter table collection_areas enable row level security;
alter table events enable row level security;
alter table event_sources enable row level security;
alter table account_events enable row level security;
alter table hotel_event_scores enable row level security;
alter table collection_runs enable row level security;

create policy "members read their account"
  on accounts for select to authenticated
  using (is_account_member(id));

create policy "members read their membership"
  on account_members for select to authenticated
  using (is_account_member(account_id));

create policy "members read their hotels"
  on hotels for select to authenticated
  using (is_account_member(account_id));
create policy "members create their hotels"
  on hotels for insert to authenticated
  with check (is_account_member(account_id));
create policy "members update their hotels"
  on hotels for update to authenticated
  using (is_account_member(account_id))
  with check (is_account_member(account_id));
create policy "members delete their hotels"
  on hotels for delete to authenticated
  using (is_account_member(account_id));

create policy "members read their collection areas"
  on collection_areas for select to authenticated
  using (is_account_member(account_id));
create policy "members create their collection areas"
  on collection_areas for insert to authenticated
  with check (is_account_member(account_id));
create policy "members update their collection areas"
  on collection_areas for update to authenticated
  using (is_account_member(account_id))
  with check (is_account_member(account_id));
create policy "members delete their collection areas"
  on collection_areas for delete to authenticated
  using (is_account_member(account_id));

create policy "members read their account events"
  on account_events for select to authenticated
  using (is_account_member(account_id));
create policy "members create their account events"
  on account_events for insert to authenticated
  with check (is_account_member(account_id));
create policy "members update their account events"
  on account_events for update to authenticated
  using (is_account_member(account_id))
  with check (is_account_member(account_id));
create policy "members delete their account events"
  on account_events for delete to authenticated
  using (is_account_member(account_id));

create policy "members read linked events"
  on events for select to authenticated
  using (
    exists (
      select 1
      from account_events
      where account_events.event_id = events.id
        and is_account_member(account_events.account_id)
    )
  );

create policy "members read linked event sources"
  on event_sources for select to authenticated
  using (
    exists (
      select 1
      from account_events
      where account_events.event_id = event_sources.event_id
        and is_account_member(account_events.account_id)
    )
  );

create policy "members read their hotel scores"
  on hotel_event_scores for select to authenticated
  using (
    exists (
      select 1
      from hotels
      where hotels.id = hotel_event_scores.hotel_id
        and is_account_member(hotels.account_id)
    )
  );
create policy "members update their hotel scores"
  on hotel_event_scores for update to authenticated
  using (
    exists (
      select 1
      from hotels
      where hotels.id = hotel_event_scores.hotel_id
        and is_account_member(hotels.account_id)
    )
  )
  with check (
    exists (
      select 1
      from hotels
      where hotels.id = hotel_event_scores.hotel_id
        and is_account_member(hotels.account_id)
    )
  );

create policy "members read their collection runs"
  on collection_runs for select to authenticated
  using (is_account_member(account_id));

grant select on accounts, account_members, events, event_sources, collection_runs to authenticated;
grant select, insert, update, delete on hotels, collection_areas, account_events to authenticated;
grant select, update on hotel_event_scores to authenticated;

