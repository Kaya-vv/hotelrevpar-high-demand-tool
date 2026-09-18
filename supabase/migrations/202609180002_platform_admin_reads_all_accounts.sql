-- The platform administrator opens a subscriber's calendar to help them. Only reading is
-- granted: no insert, update or delete policy is added, so the database itself refuses any
-- change to another account's hotels, events or exports.
create or replace function public.is_platform_admin()
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
    where account_members.user_id = auth.uid()
      and account_members.role = 'platform_admin'
      and accounts.active
  );
$$;

revoke all on function public.is_platform_admin() from public;
grant execute on function public.is_platform_admin() to authenticated;

create policy "platform admin reads every account"
  on public.accounts for select to authenticated
  using (public.is_platform_admin());

create policy "platform admin reads every hotel"
  on public.hotels for select to authenticated
  using (public.is_platform_admin());

create policy "platform admin reads every collection area"
  on public.collection_areas for select to authenticated
  using (public.is_platform_admin());

create policy "platform admin reads every event area link"
  on public.account_event_areas for select to authenticated
  using (public.is_platform_admin());

create policy "platform admin reads every account event"
  on public.account_events for select to authenticated
  using (public.is_platform_admin());

create policy "platform admin reads every event"
  on public.events for select to authenticated
  using (public.is_platform_admin());

create policy "platform admin reads every event source"
  on public.event_sources for select to authenticated
  using (public.is_platform_admin());

create policy "platform admin reads every hotel score"
  on public.hotel_event_scores for select to authenticated
  using (public.is_platform_admin());

create policy "platform admin reads every collection run"
  on public.collection_runs for select to authenticated
  using (public.is_platform_admin());

create policy "platform admin reads every collection job"
  on public.collection_jobs for select to authenticated
  using (public.is_platform_admin());

create policy "platform admin reads every export batch"
  on public.export_batches for select to authenticated
  using (public.is_platform_admin());

create policy "platform admin reads every export claim"
  on public.hotel_event_exports for select to authenticated
  using (public.is_platform_admin());
