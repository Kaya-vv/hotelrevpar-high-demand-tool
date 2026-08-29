create type collection_job_status as enum (
  'queued',
  'running',
  'succeeded',
  'partial',
  'failed',
  'skipped'
);

alter table account_events
  add column review_target_event_id uuid references events on delete set null,
  add column review_source_id uuid references event_sources on delete set null,
  add column review_fingerprint text,
  add column resolved_review_fingerprint text;

alter table event_sources
  add column extracted_end_at timestamptz;

create table collection_jobs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  account_id uuid not null references accounts on delete cascade,
  collection_area_id uuid not null references collection_areas on delete cascade,
  trigger run_trigger not null,
  status collection_job_status not null default 'queued',
  attempts integer not null default 0 check (attempts >= 0),
  collection_run_id uuid references collection_runs on delete set null,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  error_summary text
);

create unique index one_active_job_per_area
  on collection_jobs (collection_area_id)
  where status in ('queued', 'running');

create index collection_jobs_account_batch_idx
  on collection_jobs (account_id, batch_id, created_at desc);

create index collection_jobs_account_status_idx
  on collection_jobs (account_id, status, created_at desc);

alter table collection_jobs enable row level security;

create policy "members read their collection jobs"
  on collection_jobs for select to authenticated
  using (is_account_member(account_id));

grant select on collection_jobs to authenticated;

grant update (
  state,
  review_reason,
  operator_note,
  override_title,
  override_start_at,
  override_end_at,
  override_venue,
  merged_into_event_id,
  decided_at,
  decided_by,
  resolved_review_fingerprint
) on account_events to authenticated;
