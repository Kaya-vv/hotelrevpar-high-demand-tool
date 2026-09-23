# Luna switch and weekly announcements — implementation plan

Design: `docs/superpowers/specs/2026-09-23-luna-switch-and-weekly-announcements-design.md`.

**Goal:** Run all AI research on gpt-6-luna with a one-month Sonnet backup, then move long-range
announcements to a weekly rhythm with an admin-maintained venue calendar list.

**Architecture:** An Anthropic-compatible Luna client replaces the Anthropic SDK client at the
connection; prompts, validation and scoring stay unchanged. Schedules become one named interval
per kind of work. Venue calendars are a database table turned into calendar leads.

## Global constraints

- Read the relevant guide in `node_modules/next/dist/docs/` before touching `src/app/**`.
- Never write to production data from scripts; the quality gate runs in `refs/luna-pipeline-db`.
- Every task: run only its own test files. Run `pnpm.cmd test`, `pnpm.cmd typecheck`,
  `pnpm.cmd lint`, `pnpm.cmd build` once at the end of each phase.
- Commit the uncommitted Hotelvraag change (`src/features/events/importance.ts` and its tests)
  on its own before starting.

## Phase 1 — Luna connection

### Task 1: Luna client

Files: create `src/features/collection/luna-client.ts`, `src/features/collection/luna-client.test.ts`.
Source to port: `scripts/luna-pipeline/translate.mjs` (`createLunaResponder`, `answerFormat`,
`LUNA_NOTE`, `lunaCost`, `SETTINGS`).

- Export `createLunaClient({ apiKey, fetchPage, transport?, concurrency? })` returning an object
  with `messages.create(params, options)` typed against the subset of
  `Anthropic.Messages.MessageCreateParamsNonStreaming` the app uses, resolving to an
  `Anthropic.Message`-shaped value.
- Request mapping, tool emulation, answer mapping, usage mapping and error handling exactly as
  listed in the design, Part 1, Components 1.
- Tests (recorded Responses payloads, no network):
  1. schema, instructions, effort by role and 32,000 answer room reach the Responses body;
  2. a `web_search` tool with `max_uses: 1` is removed from the next round after one call;
  3. a `web_fetch` call to a URL not in the task or search results returns
     `web_fetch_tool_result_error` with `url_not_allowed`, and the page fetcher is not called;
  4. a fetched page appears as `web_fetch_tool_result` with its URL;
  5. `incomplete` with `max_output_tokens` maps to `stop_reason: "max_tokens"`;
  6. 429 with "try again in 2s" waits and succeeds; `insufficient_quota` throws without retry.

Acceptance: the six tests pass.

### Task 2: Provider switch and cost

Files: create `src/features/collection/research-client.ts`; modify
`src/features/collection/sources/claude.ts` (client at ~730, ~1465, ~1543; batching at ~732),
`src/features/collection/sources/long-range.ts` (~321-324),
`src/features/collection/market-research.ts` (~89), `src/features/collection/research-budget.ts`,
`.env.example` if present.

- `researchClient()` returns the Luna client when `RESEARCH_PROVIDER` is unset or `luna`, the
  Anthropic SDK client when `sonnet`. `researchBatchingEnabled()` is false under Luna.
- Model names: under Luna every role sends `gpt-6-luna`; the role is passed so the client picks
  effort. Recorded `model` is `gpt-6-luna`.
- `modelRates` / `estimatedCostUsd`: Luna rates from the design; long-prompt surcharge; $0.01 per
  web search.
- Tests: `research-budget` cost of a recorded Luna usage row equals the value `lunaCost` gave in
  round 2 for the same row; `market-research.test.ts` batch-setting test extended so Luna never
  batches.

Acceptance: existing collection test suite passes unchanged apart from the extended cases.

### Task 3: Rate-limit staggering

Files: modify `src/app/api/cron/collect/route.ts`, add a test beside it.

- Each location's weekly work runs on a fixed weekday derived from its area id; manual refreshes
  ignore the weekday.
- Test: ten area ids spread over at least five weekdays; a due area outside its weekday is not
  queued; a manual trigger is.

### Task 4: Quality gate

Files: modify `scripts/luna-pipeline/run.mjs` to use `RESEARCH_PROVIDER=luna` with the in-app
client instead of the network intercept; keep the ledger and `--allow-paid`.

- Run Eindhoven and Utrecht with `--reset`; regenerate `out/luna-pipeline/comparison.md`.
- Accept: Eindhoven ≥ 10/15, Utrecht ≥ 3/8, zero requests lost, ≤ $2.50 per location per run.
  Stop and report if not met.

### Task 5: Switch production

- Add `OPENAI_API_KEY` and `RESEARCH_PROVIDER=luna` in Vercel; deploy.
- Watch the first run per location on the source-health admin page: requests, failures, cost.
- Record the switch date; the backup month ends 30 days later.

## Phase 2 — Weekly announcements (after Task 5)

### Task 6: Named intervals

Files: `src/features/collection/schedule.ts`, `schedule.test.ts`, `run.ts:89`,
`repository.ts:85`, `sources/long-range.ts` (`nextCheckAt` ~158, gates ~283, ~343, ~462-464,
~577), `market-research.ts:37`, `app/api/cron/collect/route.ts:66`.

- Replace `CHECK_INTERVAL_DAYS` / `BROAD_SEARCH_INTERVAL_DAYS` with
  `ANNOUNCEMENT_SEARCH_DAYS = 7`, `VENUE_CALENDAR_DAYS = 7`, `LEAD_RECHECK_DAYS = 30`,
  `CONFIRMED_RECHECK_DAYS = 90`, `NEAR_TERM_SEARCH_DAYS = 14`. Every consumer names the one it
  means.
- `nextCheckAt(lead, now)`: venue-list calendars 7, confirmed editions 90, everything else 30.
- Rewrite the tests that pin 30 days: `schedule.test.ts`, `run.test.ts` ("at most once every 30
  days"), `long-range.test.ts` (`nextCheckAt`), `research.test.ts` ("next monthly check",
  "searches fully after 30 days").

Acceptance: a confirmed lead is not due at day 30 and is due at day 90; a pending lead is due
at day 30; the long-range broad search is due at day 7; near-term is due at day 14.

### Task 7: Venue calendar table and starting list

Files: new migration in `supabase/migrations/`, regenerate `src/lib/supabase/database.types.ts`.

- Table `venue_calendars` (id, name, url unique, city, latitude, longitude, national boolean,
  active boolean, created_at, updated_at); row-level security: platform admins only.
- Seed rows: the venues in `src/features/events/venues.ts`, Mojo (national), and the main concert
  or fair venue of each location. Open every URL first and keep only pages that list upcoming
  events.

### Task 8: Calendars become leads

Files: `src/features/collection/run.ts` or `market-research.ts` (where seeds are loaded),
`src/features/collection/long-range-store.ts` (`origin: "venue_list"`),
`src/features/collection/sources/long-range.ts` (seed merge ~435, slot ordering).

- Load active calendars within the market radius plus national ones; merge as
  `kind: "calendar"`, `origin: "venue_list"` leads keyed by URL; a calendar no longer on the list
  stops being scheduled.
- Venue-list calendars go first in `CALENDAR_SLOTS`.
- Tests: inside radius and national become leads; outside radius and switched off do not; a
  venue-list calendar is ordered before a discovered calendar.

### Task 9: Admin page

Files: `src/app/admin/venue-calendars/page.tsx` plus actions, following
`src/app/admin/accounts/page.tsx` for access control and layout; link from the admin navigation.

- List (name, city, national, active, last checked), add (name, URL, city → geocoded), switch
  off/on, remove. URL must be `https://`.
- Test with the existing admin page test pattern: non-admin is refused; adding a row shows it.
- Verify in the browser.

### Task 10: Remove Sonnet (30 days after Task 5)

- Only if `RESEARCH_PROVIDER` stayed `luna`. Delete the provider switch,
  `anthropic-batches.ts`, `batch-identity.ts`, their tests, `ANTHROPIC_*` settings; drop
  `anthropic_batch_cache` in a migration once no row is `processing`.
- Update `docs/pilot-runbook.md` and `docs/luna-comparison.md`.
