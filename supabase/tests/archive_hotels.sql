begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(8);

insert into auth.users(id, email) values
  ('91400000-0000-0000-0000-000000000001', 'delete-login@subscriber.test'),
  ('91400000-0000-0000-0000-000000000002', 'replacement@subscriber.test');
insert into accounts(id, name) values ('91400000-0000-0000-0000-000000000010', 'Preserved account');
insert into account_members(account_id, user_id) values
  ('91400000-0000-0000-0000-000000000010', '91400000-0000-0000-0000-000000000001');
insert into hotels(id, account_id, name, revcontrol_code, latitude, longitude, demand_radius_km) values
  ('91400000-0000-0000-0000-000000000020', '91400000-0000-0000-0000-000000000010', 'Preserved hotel', 'TEST', 51.44, 5.48, 25);
insert into events(id, normalized_identity, title, category, start_at, end_at, certainty) values
  ('91400000-0000-0000-0000-000000000030', 'subscriber-deletion-test', 'Saved event', 'concert', '2027-01-01', '2027-01-02', 'confirmed');
insert into account_events(account_id, event_id, state, decided_by, operator_note) values
  ('91400000-0000-0000-0000-000000000010', '91400000-0000-0000-0000-000000000030', 'active', '91400000-0000-0000-0000-000000000001', 'Keep this decision');
insert into export_batches(id, account_id, created_by, request_key, request_hash, selection, workbook) values
  ('91400000-0000-0000-0000-000000000040', '91400000-0000-0000-0000-000000000010', '91400000-0000-0000-0000-000000000001', gen_random_uuid(), 'test', '{}', decode('010203', 'hex'));
insert into export_items(batch_id, account_id, hotel_id, event_id, snapshot) values
  ('91400000-0000-0000-0000-000000000040', '91400000-0000-0000-0000-000000000010', '91400000-0000-0000-0000-000000000020', '91400000-0000-0000-0000-000000000030', '{"title":"Saved event"}');
insert into event_notification_batches(id, account_id, hotel_id, user_id) values
  ('91400000-0000-0000-0000-000000000050', '91400000-0000-0000-0000-000000000010', '91400000-0000-0000-0000-000000000020', '91400000-0000-0000-0000-000000000001');
insert into event_notification_items(account_id, hotel_id, event_id, user_id, batch_id) values
  ('91400000-0000-0000-0000-000000000010', '91400000-0000-0000-0000-000000000020', '91400000-0000-0000-0000-000000000030', '91400000-0000-0000-0000-000000000001', '91400000-0000-0000-0000-000000000050');


insert into collection_jobs(batch_id, account_id, collection_area_id, trigger)
select gen_random_uuid(), account_id, id, 'manual' from collection_areas
where hotel_id = '91400000-0000-0000-0000-000000000020';
update hotels set archived_at = now() where id = '91400000-0000-0000-0000-000000000020';
select ok((select archived_at is not null from hotels where id='91400000-0000-0000-0000-000000000020'), 'hotel is archived');
select is((select status::text from collection_jobs where collection_area_id in (select id from collection_areas where hotel_id='91400000-0000-0000-0000-000000000020')), 'skipped', 'queued search is stopped');
select is((select status from event_notification_batches where id='91400000-0000-0000-0000-000000000050'), 'cancelled', 'unsent email is cancelled');
select ok((select suppressed from event_notification_items where hotel_id='91400000-0000-0000-0000-000000000020'), 'old notification will not be resent after restore');
select is((select count(*) from collection_areas where hotel_id='91400000-0000-0000-0000-000000000020'), 1::bigint, 'collection area and evidence links remain');
select is((select snapshot->>'title' from export_items where batch_id='91400000-0000-0000-0000-000000000040'), 'Saved event', 'export history is preserved');
update hotels set archived_at = null where id='91400000-0000-0000-0000-000000000020';
select ok((select archived_at is null from hotels where id='91400000-0000-0000-0000-000000000020'), 'hotel can be restored');
select is((select operator_note from account_events where event_id='91400000-0000-0000-0000-000000000030'), 'Keep this decision', 'saved event decision remains after restore');
select * from finish();
rollback;
