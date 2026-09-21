begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(8);

insert into events(id, normalized_identity, title, category, start_at, end_at, certainty) values
  ('e2f00697-d9e7-4c66-be91-b5197c21dc8b', 'swim-original-test', 'NK lange baan', 'swimming', '2027-06-02T22:00:00Z', '2027-06-06T21:59:59Z', 'confirmed'),
  ('ded6ac76-8221-4429-9907-c3eb732ce2cf', 'swim-duplicate-test', 'NK Zwemmen Lange Baan', 'swimming', '2027-06-02T22:00:00Z', '2027-06-06T21:59:59Z', 'confirmed');
insert into event_sources(event_id, provider, provider_event_id, source_url, public_source_url, extracted_title, extracted_start_at, source_state)
select id, 'claude', id::text, 'https://www.knzb.nl/nieuws/wedstrijdkalender-2026-2027-bekend',
  'https://www.knzb.nl/nieuws/wedstrijdkalender-2026-2027-bekend', title, start_at, 'active'
from events where id in ('e2f00697-d9e7-4c66-be91-b5197c21dc8b', 'ded6ac76-8221-4429-9907-c3eb732ce2cf');

create temporary table scenarios (id uuid default gen_random_uuid(), hotel uuid default gen_random_uuid(), name text);
insert into scenarios(name) values ('merge'), ('excluded original'), ('missing hotel link'), ('manual priority');
insert into accounts(id, name) select id, name from scenarios;
insert into hotels(id, account_id, name, revcontrol_code, latitude, longitude, demand_radius_km)
select hotel, id, name, 'TEST', 51.44, 5.48, 25 from scenarios;
insert into account_events(account_id, event_id, state)
select s.id, e.id, case when s.name = 'excluded original' and e.id = 'e2f00697-d9e7-4c66-be91-b5197c21dc8b' then 'excluded'::account_event_state else 'active'::account_event_state end
from scenarios s cross join events e
where e.id in ('e2f00697-d9e7-4c66-be91-b5197c21dc8b', 'ded6ac76-8221-4429-9907-c3eb732ce2cf');
insert into account_event_areas(account_id, collection_area_id, event_id)
select s.id, area.id, e.id from scenarios s join collection_areas area on area.hotel_id = s.hotel
cross join events e
where e.id in ('e2f00697-d9e7-4c66-be91-b5197c21dc8b', 'ded6ac76-8221-4429-9907-c3eb732ce2cf')
  and not (s.name = 'missing hotel link' and e.id = 'e2f00697-d9e7-4c66-be91-b5197c21dc8b');
insert into hotel_event_scores(hotel_id, event_id, impact_points, distance_points, stay_pressure_points, total, suggested_importance, impact_basis, importance_override)
select hotel, 'ded6ac76-8221-4429-9907-c3eb732ce2cf', 45, 23, 11, 79, 'High', 'ai_assessment', 'Peak'
from scenarios where name = 'manual priority';
insert into auth.users(id, email) values ('92100000-0000-0000-0000-000000000001', 'swimming-test@example.test');
insert into event_notification_items(account_id, hotel_id, user_id, event_id)
select id, hotel, '92100000-0000-0000-0000-000000000001', 'ded6ac76-8221-4429-9907-c3eb732ce2cf' from scenarios where name = 'merge';

\ir ../migrations/202609210001_swimming_duplicate.sql

select is((select state::text from account_events where account_id = (select id from scenarios where name = 'merge') and event_id = 'ded6ac76-8221-4429-9907-c3eb732ce2cf'), 'excluded', 'duplicate is hidden');
select is((select merged_into_event_id::text from account_events where account_id = (select id from scenarios where name = 'merge') and event_id = 'ded6ac76-8221-4429-9907-c3eb732ce2cf'), 'e2f00697-d9e7-4c66-be91-b5197c21dc8b', 'original is retained as merge target');
select is((select count(*) from account_events where event_id = 'ded6ac76-8221-4429-9907-c3eb732ce2cf' and state = 'active'), 3::bigint, 'manual priority, excluded original and missing hotel links are protected');
select is((select count(*) from events where id in ('e2f00697-d9e7-4c66-be91-b5197c21dc8b', 'ded6ac76-8221-4429-9907-c3eb732ce2cf')), 2::bigint, 'both event records retained');
select is((select count(*) from event_sources where event_id in ('e2f00697-d9e7-4c66-be91-b5197c21dc8b', 'ded6ac76-8221-4429-9907-c3eb732ce2cf')), 2::bigint, 'source history retained');
select ok((select suppressed from event_notification_items where user_id = '92100000-0000-0000-0000-000000000001'), 'duplicate will not be emailed again');

\ir ../migrations/202609210001_swimming_duplicate.sql

select is((select count(*) from account_events where merged_into_event_id = 'e2f00697-d9e7-4c66-be91-b5197c21dc8b'), 1::bigint, 'repeat application changes no further decisions');
select is((select importance_override from hotel_event_scores where hotel_id = (select hotel from scenarios where name = 'manual priority')), 'Peak', 'manual priority is preserved');
select * from finish();
rollback;
