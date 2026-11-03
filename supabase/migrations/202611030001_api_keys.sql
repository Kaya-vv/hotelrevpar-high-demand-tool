-- Per-account keys that let a revenue management system (RevControl first) fetch this account's
-- events from /api/v1. Only a SHA-256 hash is stored; the key itself is shown once at creation.
-- Read and written only by the server with the service role.
create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  key_prefix text not null,
  key_hash text not null unique,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index api_keys_account_id_idx on public.api_keys (account_id);
alter table public.api_keys enable row level security;
revoke all on public.api_keys from anon, authenticated;
grant select, insert, update, delete on public.api_keys to service_role;
