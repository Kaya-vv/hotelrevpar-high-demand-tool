-- A free trial account. NULL means "not a trial": every account that existed before this keeps
-- full access. Cleared when the account buys the paid package.
alter table public.accounts
  add column trial_ends_at timestamptz,
  add column trial_reminder_sent_at timestamptz;
