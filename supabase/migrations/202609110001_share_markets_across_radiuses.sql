-- A city search is reusable by any hotel whose own radius is no wider than the search asked for:
-- what reaches a calendar is filtered afterwards by measured distance, not by the search radius.
-- Both market tables were keyed by a hash that included the radius, so a 30 km hotel in a city
-- already swept at 25 km re-bought the whole city. Storing the city and radius as columns lets a
-- lookup ask for "same city, wide enough radius" instead of demanding an exact match.

-- The 90-day search. `cache_key` stays the primary key so one row per (city, radius) survives;
-- `market_key` is the same hash with the radius left out, which is what the lookup matches on.
alter table public.claude_market_cache
  add column market_key text;

create index claude_market_cache_market_idx
  on public.claude_market_cache (market_key, radius_km);

-- The year-ahead research. Its key is a bare hash, so it carried nothing to match a city on.
-- The lease function inserts a row before the caller is known, so these stay nullable and the
-- application fills them in on the next claim.
alter table public.long_range_markets
  add column search_location text,
  add column radius_km double precision;

create index long_range_markets_market_idx
  on public.long_range_markets (search_location, radius_km);
