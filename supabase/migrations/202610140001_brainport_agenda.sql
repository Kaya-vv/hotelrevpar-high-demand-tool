-- Brainport Eindhoven's event agenda lists the region's business conferences, which the city
-- searches kept missing: PIC Summit Europe (3-4 Nov 2026, 700+ visitors from 20+ countries) and
-- AI Summit Brainport (12 Nov 2026) both sit on it. Both pages were read with the app's own page
-- fetcher on 14 October 2026: the first lists events until mid-November, page 2 continues to
-- April 2027. The Dutch pages are used because they list more events than /en/events.
insert into public.venue_calendars (name, url, city, national) values
  ('Brainport Eindhoven evenementen', 'https://brainporteindhoven.com/nl/evenementen', 'Eindhoven', false),
  ('Brainport Eindhoven evenementen (vervolg)', 'https://brainporteindhoven.com/nl/evenementen/page/2', 'Eindhoven', false)
on conflict (url) do nothing;
