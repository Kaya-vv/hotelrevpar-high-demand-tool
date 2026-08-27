begin;

create extension if not exists pgtap with schema extensions;
select plan(3);

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '20000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'a@example.com',
    '',
    now(),
    '{}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '20000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'b@example.com',
    '',
    now(),
    '{}',
    '{}',
    now(),
    now()
  );

insert into accounts (id, name)
values
  ('10000000-0000-0000-0000-000000000001', 'A'),
  ('10000000-0000-0000-0000-000000000002', 'B');

insert into account_members (account_id, user_id, role)
values
  (
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'operator'
  ),
  (
    '10000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000002',
    'operator'
  );

insert into hotels (
  account_id,
  name,
  revcontrol_code,
  latitude,
  longitude,
  demand_radius_km
)
values (
  '10000000-0000-0000-0000-000000000001',
  'Hotel A',
  'A',
  51.44,
  5.48,
  25
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);

select is((select count(*) from hotels), 0::bigint, 'other account hotel is hidden');

select throws_ok(
  $$
    insert into hotels (
      account_id,
      name,
      revcontrol_code,
      latitude,
      longitude,
      demand_radius_km
    ) values (
      '10000000-0000-0000-0000-000000000001',
      'X',
      'X',
      51,
      5,
      25
    )
  $$,
  '42501'
);

select is((select count(*) from accounts), 1::bigint, 'operator sees one account');
select * from finish();

rollback;
