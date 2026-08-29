create table event_candidate_reviews (
  collection_area_id uuid not null references collection_areas on delete cascade,
  provider text not null,
  provider_event_id text not null,
  fingerprint text not null,
  decision text not null check (decision in ('keep', 'exclude')),
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  demand_level text not null check (demand_level in ('low', 'medium', 'high', 'peak')),
  source_url text,
  evidence_text text not null,
  checked_at timestamptz not null default now(),
  primary key (collection_area_id, provider, provider_event_id)
);

alter table event_candidate_reviews enable row level security;

create policy "members read their candidate reviews"
  on event_candidate_reviews for select to authenticated
  using (
    exists (
      select 1
      from collection_areas
      where collection_areas.id = event_candidate_reviews.collection_area_id
        and is_account_member(collection_areas.account_id)
    )
  );

grant select on event_candidate_reviews to authenticated;
