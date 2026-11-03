-- Export-only levels are gone (see 202611030002): the calendar's level is the only one. Run after
-- the code that no longer passes p_choices is live.
drop function public.commit_hotel_export(uuid,uuid,uuid,text,jsonb,text,jsonb,jsonb);

create or replace function public.transfer_export_identity(p_account uuid,p_old uuid,p_new uuid)
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
  update hotel_event_exports set canonical_event_id=p_new where account_id=p_account and canonical_event_id=p_old;
  -- Retain the old claim too: a stale source must not make either identity look new.
end $$;

drop table public.announcement_export_choices;
