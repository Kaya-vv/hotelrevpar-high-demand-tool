-- A daily Ticketmaster-only check runs next to each hotel's weekly full search. The scope keeps it
-- out of everything that reads "the hotel's last search": the weekly schedule, the calendar's
-- status line, the dashboard and the source health report.
alter table public.collection_jobs add column scope text not null default 'full'
  check (scope in ('full', 'ticketmaster'));
alter table public.collection_runs add column scope text not null default 'full'
  check (scope in ('full', 'ticketmaster'));
