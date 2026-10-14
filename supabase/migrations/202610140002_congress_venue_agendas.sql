-- Congress and event halls near subscribed hotels, so business events are read from the venue
-- itself rather than left to city searches that favour concerts. Each URL was read with the
-- app's own page fetcher on 14 October 2026 and listed dated upcoming events.
-- Left out because the app cannot read their events: RAI Amsterdam (the agenda only fills in
-- with JavaScript; the page reads 24 characters), De Doelen Rotterdam (endless redirects),
-- Beurs van Berlage (empty page) and WTC Rotterdam (no agenda page).
insert into public.venue_calendars (name, url, city, national) values
  ('World Forum The Hague', 'https://worldforum.nl/agenda/', '''s-Gravenhage', false),
  ('Brabanthallen', 'https://www.brabanthallen.nl/agenda/', '''s-Hertogenbosch', false),
  ('Mikrocentrum', 'https://mikrocentrum.nl/nl/evenementen/agenda/', 'Veldhoven', false),
  ('Breepark', 'https://breepark.nl/agenda/', 'Breda', false)
on conflict (url) do nothing;
