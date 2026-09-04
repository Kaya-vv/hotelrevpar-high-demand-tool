create table anthropic_batch_cache (
  cache_key text primary key,
  owner_token uuid not null,
  batch_id text,
  status text not null check (status in ('creating', 'processing', 'completed', 'failed')),
  results jsonb,
  error text,
  usage_reported boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index anthropic_batch_cache_expiry_idx
  on anthropic_batch_cache (expires_at);

create table claude_market_cache (
  cache_key text primary key,
  search_location text not null,
  radius_km double precision not null,
  window_start date not null,
  window_end date not null,
  model text not null,
  discovery_model text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index claude_market_cache_expiry_idx
  on claude_market_cache (expires_at);

alter table anthropic_batch_cache enable row level security;
alter table claude_market_cache enable row level security;

-- Service-role only: subscribers must never read another account's collection cache.
