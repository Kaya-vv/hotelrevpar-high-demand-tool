alter table hotels
  add column search_location text not null default '',
  add column enabled_sources text[] not null default array['rijksoverheid', 'openholidays', 'ticketmaster', 'predicthq', 'claude'];

alter table collection_areas
  add column hotel_id uuid references hotels on delete cascade,
  add column search_location text not null default '';

alter table collection_areas drop constraint collection_areas_account_id_name_key;

create unique index collection_areas_hotel_id_key
  on collection_areas (hotel_id)
  where hotel_id is not null;

update hotels as hotel
set search_location = coalesce(
  (
    select area.name
    from collection_areas as area
    where area.account_id = hotel.account_id
    order by
      power(area.latitude - hotel.latitude, 2) +
      power(area.longitude - hotel.longitude, 2)
    limit 1
  ),
  nullif(hotel.address, ''),
  hotel.name
);

insert into collection_areas (
  account_id,
  hotel_id,
  name,
  search_location,
  latitude,
  longitude,
  radius_km,
  enabled_sources
)
select
  hotel.account_id,
  hotel.id,
  hotel.name,
  hotel.search_location,
  hotel.latitude,
  hotel.longitude,
  hotel.demand_radius_km,
  coalesce(
    (
      select area.enabled_sources
      from collection_areas as area
      where area.account_id = hotel.account_id
        and area.hotel_id is null
      order by
        power(area.latitude - hotel.latitude, 2) +
        power(area.longitude - hotel.longitude, 2)
      limit 1
    ),
    hotel.enabled_sources
  )
from hotels as hotel;

update hotels as hotel
set enabled_sources = area.enabled_sources
from collection_areas as area
where area.hotel_id = hotel.id;

create function sync_hotel_collection_area()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  insert into collection_areas (
    account_id,
    hotel_id,
    name,
    search_location,
    latitude,
    longitude,
    radius_km,
    enabled_sources
  ) values (
    new.account_id,
    new.id,
    new.name,
    new.search_location,
    new.latitude,
    new.longitude,
    new.demand_radius_km,
    new.enabled_sources
  )
  on conflict (hotel_id) where hotel_id is not null
  do update set
    account_id = excluded.account_id,
    name = excluded.name,
    search_location = excluded.search_location,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    radius_km = excluded.radius_km,
    enabled_sources = excluded.enabled_sources;

  return new;
end;
$$;

revoke all on function sync_hotel_collection_area() from public;

create trigger sync_hotel_collection_area_after_write
after insert or update of
  account_id,
  name,
  search_location,
  latitude,
  longitude,
  demand_radius_km,
  enabled_sources
on hotels
for each row execute function sync_hotel_collection_area();
