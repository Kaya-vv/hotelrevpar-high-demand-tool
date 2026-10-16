-- Congress halls without a public agenda, maintained by platform admins. The near-term search looks
-- for business events at each hall by name, because its congresses are announced only on the
-- organisers' own websites. Access is restricted to the service role.
create table public.venue_searches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text not null,
  latitude double precision,
  longitude double precision,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name, city)
);
alter table public.venue_searches enable row level security;
revoke all on public.venue_searches from anon, authenticated;
grant select, insert, update, delete on public.venue_searches to service_role;

-- Missed on 16 October 2026: the Post-Quantum Cryptography Conference (1-3 December 2026, the whole
-- building for three days) and smaller congresses, none of them on the trade-fair listings.
insert into public.venue_searches (name, city) values ('Meervaart', 'Amsterdam');
