# Luna switch and weekly announcement checks — design

Date: 2026-09-23. Status: awaiting owner review.

## Summary for the owner

1. The app switches its AI searches from Sonnet (plus Haiku) to Luna. For one month Sonnet stays
   available behind a single switch, so we can go back within minutes. After that month Sonnet
   is removed.
2. After the switch the long-range search runs weekly for new things only: a web search for new
   announcements plus a short list of big venue calendars (ArenA, Ziggo Dome, Mojo...). Known
   events keep their own, slower rhythm. The near-term search moves from monthly to every two
   weeks.
3. The venue calendar list lives on a new admin page. It starts with a list we create now,
   based on the big venues the app already knows (Ziggo Dome, GelreDome, ArenA, Ahoy...), plus
   Mojo.

Expected cost for 10 locations: about $30-45 a month, against about $60 today with Sonnet on the
monthly schedule. New big events appear within about a week of being announced instead of up to
a month.

## Decisions taken

| Question | Decision | Source |
| --- | --- | --- |
| How careful is the switch | Switch every location at once; Sonnet remains available behind a switch for one month, then removed | Owner, 2026-09-23 |
| Who maintains the venue calendars | Owner, on an admin page, pre-filled with a list we create now | Owner, 2026-09-23 |
| Luna settings | The settings measured in round 2 of the comparison: thinking on (high for Sonnet's tasks, medium for Haiku's), 32,000-token answer room, the quote rule note | `docs/luna-comparison.md`, `out/luna-pipeline/comparison.md` |
| Batch discount | Not used for Luna. OpenAI's Batch API refuses web search, and web search fees are about 75% of Luna's bill; the saving on the rest is about 10-15% | OpenAI community reports of `web_search_unsupported`; round-2 cost split |
| Order | Luna first, then the schedule. The weekly schedule is only affordable with Luna's prices | Owner |

## Part 1 — Luna connection

### Approach

The app's research code builds requests in Anthropic's message format and reads Anthropic's
answer format in about 8 places (`sources/claude.ts`, `sources/long-range.ts`) and 20+ test
files. Three ways to connect Luna were considered:

- **A. Translate at the connection (chosen).** A Luna client that accepts the same requests the
  app sends today and returns answers in the same shape. The prompts, answer checks, quote
  checks, scoring and all tests stay as they are. This is exactly the code path measured in the
  comparison (Eindhoven 10-11 of 15 benchmark events, Utrecht 3 of 8, about $1.50-1.75 per
  location per run), so the measured quality carries over. The backup month is a one-line
  switch.
- B. Rewrite every call site for OpenAI's format. Cleanest end state, but it changes the code the
  comparison measured, touches 20+ test files, and makes the backup month a second code path.
- C. A provider-neutral request layer with two backends. Most work; only pays off if we keep two
  providers long term, which we will not.

Trade-off of A, stated plainly: after Sonnet is removed, the app still speaks Anthropic's
request format internally and keeps the Anthropic package for its types and schema helper. That
is a translation layer we carry. It can be replaced by B later without changing behaviour.

### Components

1. **`src/features/collection/luna-client.ts`** — production port of
   `scripts/luna-pipeline/translate.mjs`. Exposes `messages.create(params, options)` with the
   subset of the Anthropic SDK surface the app uses. Responsibilities:
   - Map a Messages request to a Responses request: system/user text, JSON schema from
     `output_config.format` (non-strict; the app's own Zod validation still decides),
     `max_output_tokens: 32_000`, reasoning effort by role (Sonnet role `high`, Haiku role
     `medium`), the `LUNA_NOTE` quote rule appended to instructions.
   - `web_search` tool → OpenAI hosted `web_search`, with `user_location` NL/city, honouring
     `max_uses` by counting calls and removing the tool when used up.
   - `web_fetch` tool → a function tool executed locally with the app's `fetchOfficialPage`
     (URL must appear in the task or in search results; `max_uses` enforced; 24,000 characters
     per page), looping up to 6 rounds.
   - Map the answer back: `content` blocks (`text`, `web_search_tool_result` with result URLs,
     `web_fetch_tool_result` with fetched URL/text or an error code), `stop_reason`
     (`end_turn` / `max_tokens`), `usage` including `server_tool_use.web_search_requests`,
     `web_fetch_requests`, cached input tokens.
   - Errors: 429 rate limit → wait the time OpenAI names, up to 30 attempts; out of credit
     (`insufficient_quota`) → throw immediately with a clear message; other 4xx → throw as a
     failed request (the lead stays due and is retried next cycle; nothing is silently dropped).
   - A process-wide limit of 4 requests at once (OpenAI organisation limit: 200,000 tokens per
     minute).
2. **`src/features/collection/research-client.ts`** — one function that returns the client for
   the configured provider: `RESEARCH_PROVIDER=luna` (default after the switch) or `sonnet`
   (backup month). Replaces the three `new Anthropic(...)` in `sources/claude.ts` (lines ~730,
   ~1465, ~1543) and the one in `sources/long-range.ts` (~322). Model names come from the same
   place: Luna uses `gpt-6-luna` for every role; the role (Sonnet-like or Haiku-like) is kept
   so reasoning effort and cost reporting stay meaningful.
3. **Batching off under Luna.** `batching.enabled` becomes false whenever the provider is Luna
   (`sources/claude.ts:732`, `sources/long-range.ts:323`, `market-research.ts:89`). The existing
   direct path is used; it already runs in production when `ANTHROPIC_BATCHES=disabled`.
   Submitted Sonnet batches still in flight at switch time drain through the existing batch code.
4. **Cost and budget.** `research-budget.ts` gets Luna's rates ($0.10 input, $0.01 cached,
   $0.50 output per million tokens; long prompts over 272,000 tokens at 2x input and 1.5x
   output; $0.01 per web search). `collection_usage_events` rows keep their columns; `model` is
   `gpt-6-luna`, `billing_mode` is `standard`. The monthly per-location research ceiling (€8)
   stays; Luna's expected long-range spend is about $3-4.5 per location per month.
5. **Staggering.** The daily cron already only queues locations whose last run is old enough.
   To keep ten locations from hitting OpenAI's per-minute limit on the same morning, each
   location gets a fixed weekday (derived from its id) for its weekly work.

### Quality gate before switching production

Run the isolated pipeline test (`scripts/luna-pipeline/run.mjs`, adapted to use the new in-app
client instead of the network intercept) for Eindhoven and Utrecht against the benchmark file.
Accept when: Eindhoven ≥ 10 of 15 upcoming benchmark events, Utrecht ≥ 3 of 8, no request lost
to rate limits, cost ≤ $2.50 per location per full run. Otherwise do not switch.

### Backup month and removal

- Switch back: set `RESEARCH_PROVIDER=sonnet` in Vercel. No code change.
- After 30 days on Luna without switching back: delete the Sonnet path — the provider switch,
  `anthropic-batches.ts`, `batch-identity.ts`, their tests, the `ANTHROPIC_*` settings and the
  Anthropic API key. The `anthropic_batch_cache` table is dropped in a migration once no rows
  are `processing`.

## Part 2 — Weekly announcements, slower re-checks

Starts only after Part 1 is live.

| Work | Interval | Where it is decided today |
| --- | --- | --- |
| Broad web search for new events and new announcements (long-range) | 7 days | `sources/long-range.ts:462-464` (`BROAD_SEARCH_INTERVAL_DAYS`, `announcementsDue`), cycle start `:343`, reuse gate `:283`, `market-research.ts:37` |
| Venue calendars on the admin list | 7 days | new |
| Newly found events | first check straight away | already so (`firstChecks`, `long-range.ts:544`) |
| Events still being worked on, waiting for next dates, failed reads, conflicts, other calendar pages | 30 days | `nextCheckAt`, `long-range.ts:158-160` |
| Events with a confirmed edition | 90 days | `nextCheckAt` |
| Near-term search | 14 days | `run.ts:89` (`claudeDiscoveryDue`), `repository.ts:85` (reuse cutoff) |
| Locations queued by the daily cron | when any of the above is due (7 days) | `app/api/cron/collect/route.ts:66` |

`schedule.ts` gets one named interval per row instead of the single 30-day constant.

### Venue calendar list

- New table `venue_calendars`: name, agenda URL, city, latitude, longitude, `national` flag,
  active flag, created/updated timestamps. Admin-only access (same guard as
  `app/admin/accounts`).
- New admin page `app/admin/venue-calendars`: list, add (name + URL + city; coordinates from the
  existing geocoder), switch off, remove.
- Starting list, in a migration, built from the venues the app already knows in
  `src/features/events/venues.ts` (Ziggo Dome, Johan Cruijff ArenA, AFAS Live, Rotterdam Ahoy,
  De Kuip, Philips Stadion, Stadion Galgenwaard, GelreDome, Euroborg) plus Mojo (national) and
  the main concert and fair venue of each location (for example TivoliVredenburg and Jaarbeurs
  for Utrecht). Every URL is opened and checked to be a page that lists upcoming events before
  it goes in.
- Each long-range run adds the active calendars within the location's search radius, plus the
  national ones, as calendar leads (`kind: "calendar"`, `origin: "venue_list"`), checked every
  7 days and placed first in the calendar slots (`CALENDAR_SLOTS`). A calendar switched off on
  the admin page stops being checked; its events already found stay.
- A page whose text did not change since last week costs nothing to re-check (existing page
  cache, `long-range.ts:670-679`).

### Cost check

Using round-2 Luna costs and 10 locations, per location per month: the weekly part (search,
venue calendars, new finds) about $0.20-0.50 a week, so $1-2; the monthly and quarterly
re-checks about $1 (one full long-range run cost $0.85-1.02); near-term about $0.60-0.80 per
run every 14 days, so $1.30-1.80. Together about $3-4.50 per location, $30-45 a month for 10.
The €8 per location monthly ceiling stays as the hard stop.

## Testing

- Luna client: unit tests with recorded Responses payloads for request mapping, tool-limit
  enforcement, the fetch loop, answer mapping, usage mapping, 429 wait, out-of-credit stop.
- Existing collection tests keep passing unchanged (they inject an Anthropic-shaped client).
- Schedule: tests that pin 30 days are rewritten to the new intervals (`schedule.test.ts`,
  `run.test.ts` "at most once every 30 days", `long-range.test.ts` `nextCheckAt`,
  `research.test.ts` "next monthly check" and "searches fully after 30 days").
- Venue list: repository test that calendars inside the radius and national ones become leads
  and a switched-off one does not.
- Quality gate run described above; one live Eindhoven run after the switch compared with the
  gate result.

## Out of scope

- OpenAI Batch API and flex processing (small saving, slower; revisit after a month of bills).
- Rewriting the research code into OpenAI's native format (approach B).
- Changing the Hotelvraag rules (done separately on 2026-09-23, uncommitted at time of writing).
