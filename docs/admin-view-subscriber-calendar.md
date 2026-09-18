# Administrator can look at a subscriber's calendar

## What changed

The hotel chooser at the top of the screen now shows every subscriber's hotel to the
platform administrator (the `hotelrevpar` login), grouped under the name of the account that
owns it. Picking such a hotel opens that client's calendar exactly as the client sees it.

While the administrator looks at someone else's hotel:

- The top of the screen says "Meekijken bij" plus the client's name, with a button
  **Terug naar mijn eigen hotels**.
- The calendar shows a yellow line: nothing can be changed here.
- The hand-set demand level ("Inschatting aanpassen") is not offered.
- Hotels, Exporteren and Datakwaliteit show a short explanation instead of data, because those
  pages save things and only work with the administrator's own hotels.

Subscribers see no change at all: they still only see their own account and hotels.

## Why it cannot change a client's data

The database itself only grants the administrator permission to *read* other accounts. No
insert, update or delete permission was added. Even if a page tried to save something in a
client's account, the database would refuse it. This was checked against a real PostgreSQL
database: reading the client's hotel, calendar events, scores, runs and exports succeeded, and
four attempts to change or delete the client's rows each touched zero rows.

## Release order

1. Apply `202609180002_platform_admin_reads_all_accounts.sql` to the live database.
   Until this runs, nothing breaks: the administrator simply keeps seeing only its own hotels.
2. Deploy the app changes.
3. Log in as the administrator, pick a subscriber hotel in the chooser, confirm the header says
   "Meekijken bij", and use **Terug naar mijn eigen hotels** to leave again.

## Verification done locally

- 5 tests on deciding whose calendar is on screen, 4 tests on picking a hotel from another
  account, and page tests for the calendar, the chooser and the "meekijken" header.
- Full test suite: 528 passed, 19 skipped. Type checking and the production build passed.
- Real browser run against a local Supabase with two accounts: the administrator opened the
  subscriber's calendar with the client's event on it, saw no hand-set level control, found the
  explanation on Hotels, Exporteren and Datakwaliteit, and returned to its own hotel. The
  subscriber login saw only its own hotel, without grouping.
- PostgreSQL permission checks as described above.
