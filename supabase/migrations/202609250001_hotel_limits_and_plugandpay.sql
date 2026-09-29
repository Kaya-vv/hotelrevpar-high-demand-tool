-- How many hotels an account may run at the same time. NULL means no limit, so every account that
-- existed before billing keeps working exactly as it did.
alter table public.accounts
  add column hotel_limit integer check (hotel_limit is null or hotel_limit >= 0),
  add column plugandpay_subscription_id text;

create unique index accounts_plugandpay_subscription_id_key
  on public.accounts (plugandpay_subscription_id)
  where plugandpay_subscription_id is not null;

-- Guard the limit in the database too, so no code path (app, admin, script) can pass it.
-- Archived hotels do not count; restoring one is treated as adding one.
-- Locking the account row makes two hotels added at the same moment wait for each other.
create function public.enforce_hotel_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare allowed integer; used integer;
begin
  if tg_op = 'UPDATE' and (new.archived_at is not null or old.archived_at is null) then
    return new;
  end if;
  select hotel_limit into allowed from accounts where id = new.account_id for update;
  if allowed is null then return new; end if;
  select count(*) into used from hotels
    where account_id = new.account_id and archived_at is null and id <> new.id;
  if used >= allowed then
    raise exception 'hotel_limit_reached' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_hotel_limit() from public;

create trigger enforce_hotel_limit_before_write
before insert or update of archived_at on public.hotels
for each row execute function public.enforce_hotel_limit();

-- A repeat purchase must raise the limit of the buyer's existing account instead of creating a
-- second one. auth.users is not readable over the API, so the lookup runs here.
create function public.account_for_billing_email(target text) returns uuid
language sql stable security definer set search_path = public, auth as $$
  select account_members.account_id
  from auth.users
  join account_members on account_members.user_id = auth.users.id
  where lower(auth.users.email) = lower(target)
  limit 1;
$$;

revoke all on function public.account_for_billing_email(text) from public;

grant execute on function public.account_for_billing_email(text) to service_role;

-- One row per Plug&Pay message. Plug&Pay retries a failed delivery five times over ~25 hours, so
-- the same order must never provision twice.
create table public.plugandpay_events (
  event_key text primary key,
  trigger_type text not null,
  triggerable_id text not null,
  account_id uuid references public.accounts on delete set null,
  status text not null check (status in ('processing', 'done', 'ignored', 'failed')),
  detail text,
  received_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.plugandpay_events enable row level security;

revoke all on public.plugandpay_events from anon, authenticated;

grant select, insert, update on public.plugandpay_events to service_role;
