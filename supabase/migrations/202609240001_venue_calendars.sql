-- Agenda pages of major venues, maintained by platform admins and re-read weekly by long-range
-- research. Access is restricted to the service role.
create table public.venue_calendars (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text not null unique,
  city text not null,
  latitude double precision,
  longitude double precision,
  national boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.venue_calendars enable row level security;
revoke all on public.venue_calendars from anon, authenticated;
grant select, insert, update, delete on public.venue_calendars to service_role;

-- Each URL was read with the app's own page fetcher on 24 September 2026 and listed upcoming
-- events. Left out because the app cannot read their events: TivoliVredenburg and Parktheater
-- Eindhoven refuse non-browser requests (403/412), the Ziggo Dome agenda only fills in with
-- JavaScript (the page reads "0 Resultaten") and the Effenaar agenda is larger than 2 MB.
insert into public.venue_calendars (name, url, city, national) values
  ('Johan Cruijff ArenA', 'https://www.johancruijffarena.nl/kalender/', 'Amsterdam', false),
  ('AFAS Live', 'https://www.afaslive.nl/agenda', 'Amsterdam', false),
  ('Rotterdam Ahoy', 'https://www.ahoy.nl/agenda', 'Rotterdam', false),
  ('GelreDome', 'https://www.gelredome.nl/agenda', 'Arnhem', false),
  ('Jaarbeurs', 'https://www.jaarbeurs.nl/agenda', 'Utrecht', false),
  ('Klokgebouw', 'https://www.klokgebouw.nl/agenda', 'Eindhoven', false),
  ('Muziekgebouw Eindhoven', 'https://mge.nl/agenda/', 'Eindhoven', false),
  ('MartiniPlaza', 'https://www.martiniplaza.nl/nl/agenda', 'Groningen', false),
  ('Mojo Concerts', 'https://www.mojo.nl/agenda', 'Amsterdam', true);
