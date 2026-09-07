alter table public.event_sources add column if not exists evidence jsonb;
alter table public.collection_usage_events
  add column if not exists request_id text,
  add column if not exists market_key text,
  add column if not exists horizon text,
  add column if not exists cache_write_tokens integer not null default 0,
  add column if not exists cache_read_tokens integer not null default 0,
  add column if not exists billing_mode text,
  add column if not exists estimated_cost_usd numeric;
create unique index if not exists collection_usage_request_id
  on public.collection_usage_events(request_id);
