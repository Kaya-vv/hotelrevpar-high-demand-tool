begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(10);

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

delete from auth.users where id = '91400000-0000-0000-0000-000000000001';

select is((select count(*) from account_members where user_id = '91400000-0000-0000-0000-000000000001'), 0::bigint, 'deleting a login removes its membership');
select is((select count(*) from accounts where id = '91400000-0000-0000-0000-000000000010'), 1::bigint, 'account remains');
select is((select count(*) from hotels where id = '91400000-0000-0000-0000-000000000020'), 1::bigint, 'hotel remains');
select is((select operator_note from account_events where event_id = '91400000-0000-0000-0000-000000000030'), 'Keep this decision', 'decision remains');
select is((select decided_by from account_events where event_id = '91400000-0000-0000-0000-000000000030'), null::uuid, 'only decision author reference is cleared');
select is((select encode(workbook, 'hex') from export_batches where id = '91400000-0000-0000-0000-000000000040'), '010203', 'workbook bytes remain unchanged');
select is((select created_by from export_batches where id = '91400000-0000-0000-0000-000000000040'), null::uuid, 'only export author reference is cleared');
select is((select snapshot->>'title' from export_items where batch_id = '91400000-0000-0000-0000-000000000040'), 'Saved event', 'export snapshot remains');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"91400000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*) from hotels where id = '91400000-0000-0000-0000-000000000020'), 0::bigint, 'old access token no longer grants hotel access');
reset role;
insert into account_members(account_id, user_id) values
  ('91400000-0000-0000-0000-000000000010', '91400000-0000-0000-0000-000000000002');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"91400000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*) from hotels where id = '91400000-0000-0000-0000-000000000020'), 1::bigint, 'replacement login can access the retained hotel');
reset role;
select * from finish();
rollback;
