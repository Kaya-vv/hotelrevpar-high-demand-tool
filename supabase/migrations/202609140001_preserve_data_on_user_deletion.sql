-- Removing a login must preserve the hotel's decisions and saved workbooks.
-- Membership already cascades from auth.users, immediately removing access.
alter table public.account_events
  drop constraint account_events_decided_by_fkey,
  add constraint account_events_decided_by_fkey
    foreign key (decided_by) references auth.users(id) on delete set null;

alter table public.export_batches
  alter column created_by drop not null,
  drop constraint export_batches_created_by_fkey,
  add constraint export_batches_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null;
