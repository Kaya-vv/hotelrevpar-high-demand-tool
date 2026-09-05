alter table public.long_range_markets
  add column lease_owner uuid,
  add column lease_until timestamptz;

-- Outlives the collection worker's 1800-second maximum duration. A terminated worker's lease
-- expires so queue retries can recover; saves are fenced so a stale worker cannot overwrite it.
create function public.claim_long_range_market(target text, owner uuid)
returns boolean language plpgsql set search_path = '' as $$
begin
  insert into public.long_range_markets (market_key, state, lease_owner, lease_until)
  values (target, '{"version":0,"discoveredAt":null,"leads":[]}'::jsonb, owner, clock_timestamp() + interval '35 minutes')
  on conflict (market_key) do update
    set lease_owner = excluded.lease_owner, lease_until = excluded.lease_until
    where public.long_range_markets.lease_until is null
       or public.long_range_markets.lease_until <= clock_timestamp();
  return found;
end;
$$;

create function public.save_long_range_market(target text, owner uuid, value jsonb)
returns boolean language plpgsql set search_path = '' as $$
begin
  update public.long_range_markets set state = value, updated_at = clock_timestamp()
  where market_key = target and lease_owner = owner and lease_until > clock_timestamp();
  return found;
end;
$$;

create function public.release_long_range_market(target text, owner uuid)
returns void language sql set search_path = '' as $$
  update public.long_range_markets set lease_owner = null, lease_until = null
  where market_key = target and lease_owner = owner;
$$;

revoke all on function public.claim_long_range_market(text, uuid) from public, anon, authenticated;
revoke all on function public.save_long_range_market(text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.release_long_range_market(text, uuid) from public, anon, authenticated;
grant execute on function public.claim_long_range_market(text, uuid) to service_role;
grant execute on function public.save_long_range_market(text, uuid, jsonb) to service_role;
grant execute on function public.release_long_range_market(text, uuid) to service_role;
