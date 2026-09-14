-- Bewaar bevestigde evenementen zonder kaartlocatie zodat een beheerder het adres later kan aanvullen.
create table unresolved_event_locations (
  collection_area_id uuid not null references collection_areas on delete cascade,
  provider text not null,
  provider_event_id text not null,
  horizon text not null check (horizon in ('near_term', 'long_range')),
  title text not null,
  venue text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  candidate jsonb not null,
  discovered_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text check (resolution in ('published', 'dismissed')),
  primary key (collection_area_id, provider, provider_event_id)
);

create index unresolved_event_locations_area_resolution_idx
  on unresolved_event_locations (collection_area_id, resolved_at);

alter table unresolved_event_locations enable row level security;

create policy "members read their unresolved event locations"
  on unresolved_event_locations for select to authenticated
  using (
    exists (
      select 1
      from collection_areas
      where collection_areas.id = unresolved_event_locations.collection_area_id
        and is_account_member(collection_areas.account_id)
    )
  );

grant select on unresolved_event_locations to authenticated;
