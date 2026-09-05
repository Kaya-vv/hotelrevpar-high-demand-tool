-- Run against a local database with the two long-range migrations applied.
-- Rolls back every test record; never needs production data.
begin;
do $$
declare
  market text := 'lease-test-' || gen_random_uuid()::text;
  first_owner uuid := gen_random_uuid();
  next_owner uuid := gen_random_uuid();
  stored jsonb;
begin
  assert public.claim_long_range_market(market, first_owner), 'First worker must acquire';
  assert not public.claim_long_range_market(market, next_owner), 'Second worker must wait';
  assert public.save_long_range_market(market, first_owner, '{"leads":["first"]}'), 'Owner can save';
  assert not public.save_long_range_market(market, next_owner, '{"leads":[]}'), 'Non-owner cannot overwrite';
  perform public.release_long_range_market(market, next_owner);
  assert not public.claim_long_range_market(market, next_owner), 'Non-owner cannot release';

  update public.long_range_markets set lease_until = clock_timestamp() - interval '1 second' where market_key = market;
  assert not public.save_long_range_market(market, first_owner, '{"leads":[]}'), 'Expired owner cannot save';
  assert public.claim_long_range_market(market, next_owner), 'Retry can take an expired lease';
  perform public.release_long_range_market(market, first_owner);
  assert not public.claim_long_range_market(market, first_owner), 'Stale release must not unlock new owner';
  assert not public.save_long_range_market(market, first_owner, '{"leads":[]}'), 'Stale owner remains fenced';
  select state into stored from public.long_range_markets where market_key = market;
  assert stored = '{"leads":["first"]}'::jsonb, 'Claiming preserves completed work';
  perform public.release_long_range_market(market, next_owner);
  assert public.claim_long_range_market(market, first_owner), 'Normal release allows the next worker';
end;
$$;
rollback;
