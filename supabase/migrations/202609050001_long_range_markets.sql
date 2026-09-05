-- Public source metadata only. Access is restricted to the collection service role.
create table public.long_range_markets (
  market_key text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.long_range_markets enable row level security;
revoke all on public.long_range_markets from anon, authenticated;
grant select, insert, update on public.long_range_markets to service_role;
