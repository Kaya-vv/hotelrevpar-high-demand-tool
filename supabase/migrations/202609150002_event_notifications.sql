alter table public.account_members
  add column event_notifications_enabled boolean not null default true;

create table public.event_notification_batches (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts on delete cascade,
  hotel_id uuid not null references public.hotels on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  recipient_email text,
  subject text,
  html_body text,
  text_body text,
  status text not null default 'preparing'
    check (status in ('preparing', 'pending', 'sending', 'sent', 'failed', 'uncertain', 'cancelled')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  first_attempt_at timestamptz,
  last_attempt_at timestamptz,
  provider_message_id text,
  error_code text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    status = 'preparing'
    or status = 'cancelled'
    or status = 'failed'
    or (recipient_email is not null and subject is not null and html_body is not null and text_body is not null)
  )
);

create table public.event_notification_items (
  account_id uuid not null references public.accounts on delete cascade,
  hotel_id uuid not null references public.hotels on delete cascade,
  event_id uuid not null references public.events on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  batch_id uuid references public.event_notification_batches on delete set null,
  suppressed boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, hotel_id, event_id)
);

create index event_notification_batches_status_idx
  on public.event_notification_batches (status, created_at);

create index event_notification_items_batch_idx
  on public.event_notification_items (batch_id)
  where batch_id is not null;

alter table public.event_notification_batches enable row level security;
alter table public.event_notification_items enable row level security;

revoke all on public.event_notification_batches, public.event_notification_items from anon, authenticated;
grant all on public.event_notification_batches, public.event_notification_items to service_role;

create or replace function public.claim_event_notification_items(
  p_account uuid,
  p_hotel uuid,
  p_user uuid,
  p_batch uuid
)
returns table(event_id uuid)
language sql
security definer
set search_path = public
as $$
  update event_notification_items as item
  set batch_id = p_batch
  where item.ctid in (
    select pending.ctid
    from event_notification_items as pending
    where pending.account_id = p_account
      and pending.hotel_id = p_hotel
      and pending.user_id = p_user
      and pending.batch_id is null
      and not pending.suppressed
    for update skip locked
  )
  returning item.event_id;
$$;

revoke all on function public.claim_event_notification_items(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_event_notification_items(uuid, uuid, uuid, uuid) to service_role;
