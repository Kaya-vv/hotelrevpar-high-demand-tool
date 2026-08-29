alter table event_candidate_reviews
  drop constraint event_candidate_reviews_decision_check;

update event_candidate_reviews
set decision = 'verify'
where decision = 'keep';

alter table event_candidate_reviews
  add constraint event_candidate_reviews_decision_check
  check (decision in ('exclude', 'verify', 'provisional'));

create table event_evidence_cache (
  provider text not null,
  provider_event_id text not null,
  fingerprint text not null,
  decision text not null check (decision in ('verified', 'unverifiable')),
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  source_url text,
  evidence_text text not null,
  checked_at timestamptz not null default now(),
  primary key (provider, provider_event_id)
);

insert into event_evidence_cache (
  provider,
  provider_event_id,
  fingerprint,
  decision,
  confidence,
  source_url,
  evidence_text,
  checked_at
)
select distinct on (provider, provider_event_id)
  provider,
  provider_event_id,
  fingerprint,
  'verified',
  confidence,
  source_url,
  evidence_text,
  checked_at
from event_candidate_reviews
where decision = 'verify' and source_url is not null
order by provider, provider_event_id, checked_at desc
on conflict (provider, provider_event_id) do nothing;

alter table event_evidence_cache enable row level security;

create table collection_usage_events (
  id bigint generated always as identity primary key,
  collection_run_id uuid not null references collection_runs on delete cascade,
  source text not null,
  phase text not null,
  model text not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  web_search_requests integer not null default 0 check (web_search_requests >= 0),
  web_fetch_requests integer not null default 0 check (web_fetch_requests >= 0),
  created_at timestamptz not null default now()
);

create index collection_usage_events_run_idx
  on collection_usage_events (collection_run_id, created_at);

alter table collection_usage_events enable row level security;

create policy "members read their collection usage"
  on collection_usage_events for select to authenticated
  using (
    exists (
      select 1
      from collection_runs
      where collection_runs.id = collection_usage_events.collection_run_id
        and is_account_member(collection_runs.account_id)
    )
  );

grant select on collection_usage_events to authenticated;
