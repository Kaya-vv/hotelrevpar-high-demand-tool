with robert_account as (
  insert into public.accounts (name)
  values ('HotelRevPar test')
  returning id
)
insert into public.account_members (account_id, user_id, role)
select
  id,
  '851959f5-402a-4960-9dc4-2183d47bf8ea'::uuid,
  'platform_admin'::public.account_role
from robert_account;