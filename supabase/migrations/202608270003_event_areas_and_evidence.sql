alter table event_sources
  add column primary_source_confirmed boolean not null default false;

create table account_event_areas (
  account_id uuid not null,
  event_id uuid not null,
  collection_area_id uuid not null references collection_areas on delete cascade,
  created_at timestamptz not null default now(),
  primary key (account_id, event_id, collection_area_id),
  foreign key (account_id, event_id) references account_events (account_id, event_id) on delete cascade
);

alter table account_event_areas enable row level security;

create policy "members read their event areas"
  on account_event_areas for select to authenticated
  using (is_account_member(account_id));

grant select on account_event_areas to authenticated;

