-- One general-knowledge answer per event to "does this draw many overnight visitors from outside
-- the region?" (big / small / unsure). Asked only for events that would otherwise show as
-- "Zelf beoordelen", because their sources prove the right kind of visitor but never the size.
-- Stored on the shared event, so every account and hotel reuses the same answer.
alter table public.events add column if not exists size_check jsonb;
