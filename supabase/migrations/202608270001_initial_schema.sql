create extension if not exists pgcrypto;

create type account_role as enum ('operator', 'platform_admin');
create type account_event_state as enum ('active', 'needs_review', 'excluded', 'ended');
create type event_certainty as enum ('confirmed', 'provisional');
create type run_trigger as enum ('cron', 'manual');

create table accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table account_members (
  account_id uuid not null references accounts on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role account_role not null default 'operator',
  primary key (account_id, user_id),
  unique (user_id)
);

create table hotels (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts on delete cascade,
  name text not null,
  revcontrol_code text not null,
  address text,
  latitude double precision not null,
  longitude double precision not null,
  demand_radius_km double precision not null check (demand_radius_km > 0),
  holiday_region text check (holiday_region in ('north', 'middle', 'south')),
  created_at timestamptz not null default now(),
  unique (account_id, revcontrol_code)
);

create table collection_areas (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts on delete cascade,
  name text not null,
  latitude double precision not null,
  longitude double precision not null,
  radius_km double precision not null check (radius_km > 0),
  enabled_sources text[] not null default array['rijksoverheid', 'openholidays', 'ticketmaster', 'predicthq', 'claude'],
  created_at timestamptz not null default now(),
  unique (account_id, name)
);

create table events (
  id uuid primary key default gen_random_uuid(),
  normalized_identity text not null,
  title text not null,
  category text not null,
  venue text,
  latitude double precision,
  longitude double precision,
  region_scope text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  source_state text not null default 'active',
  certainty event_certainty not null default 'confirmed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at >= start_at)
);

create table event_sources (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events on delete cascade,
  provider text not null,
  provider_event_id text not null,
  source_url text not null,
  extracted_title text not null,
  extracted_start_at timestamptz not null,
  extracted_location text,
  evidence_text text,
  source_state text not null,
  certainty event_certainty not null default 'confirmed',
  local_rank integer,
  attendance integer,
  venue_capacity integer,
  checked_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create table account_events (
  account_id uuid not null references accounts on delete cascade,
  event_id uuid not null references events on delete cascade,
  state account_event_state not null,
  review_reason text,
  operator_note text,
  override_title text,
  override_start_at timestamptz,
  override_end_at timestamptz,
  override_venue text,
  merged_into_event_id uuid references events,
  decided_at timestamptz,
  decided_by uuid references auth.users,
  primary key (account_id, event_id)
);

create table hotel_event_scores (
  hotel_id uuid not null references hotels on delete cascade,
  event_id uuid not null references events on delete cascade,
  distance_km double precision,
  impact_points integer not null,
  distance_points integer not null,
  stay_pressure_points integer not null,
  total integer not null,
  suggested_importance text not null,
  impact_basis text not null,
  importance_override text,
  override_note text,
  primary key (hotel_id, event_id)
);

create table collection_runs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts on delete cascade,
  collection_area_id uuid not null references collection_areas on delete cascade,
  trigger run_trigger not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  source_results jsonb not null default '{}'::jsonb,
  cost_usage jsonb not null default '{}'::jsonb,
  error_summary text
);

create unique index one_active_run_per_area
  on collection_runs (collection_area_id)
  where finished_at is null;

create index events_window_idx on events (start_at, end_at);
create index account_events_state_idx on account_events (account_id, state);
create index event_sources_event_idx on event_sources (event_id);
create index hotel_event_scores_event_idx on hotel_event_scores (event_id);

