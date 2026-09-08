-- A job whose Anthropic batch is still processing stays `running` while its worker is released.
-- The marker distinguishes that deliberate continuation from a worker that was killed mid-run.
alter table collection_jobs add column pending_since timestamptz;
