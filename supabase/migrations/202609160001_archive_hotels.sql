alter table public.hotels add column archived_at timestamptz;

-- Archive queued work atomically with the hotel. Keep every history row.
create function public.archive_hotel_pending_work()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.archived_at is not null and old.archived_at is null then
    update collection_jobs set status = 'skipped', finished_at = now(), pending_since = null
      where collection_area_id in (select id from collection_areas where hotel_id = new.id)
        and status = 'queued';
    update event_notification_batches set status = 'cancelled'
      where hotel_id = new.id and status in ('preparing', 'pending', 'sending');
    update event_notification_items set suppressed = true
      where hotel_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function public.archive_hotel_pending_work() from public;
create trigger archive_hotel_pending_work_after_update
after update of archived_at on public.hotels
for each row execute function public.archive_hotel_pending_work();
