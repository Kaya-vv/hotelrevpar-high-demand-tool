-- An ended free trial loses access at its end time, not at the next daily switch-off. Every
-- member read and write policy goes through this function, so the login, the pages and direct
-- database reads all stop together.
create or replace function is_account_member(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from account_members
    join accounts on accounts.id = account_members.account_id
    where account_members.account_id = target
      and account_members.user_id = auth.uid()
      and accounts.active
      and (accounts.trial_ends_at is null or accounts.trial_ends_at > now())
  );
$$;
