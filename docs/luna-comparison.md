# Luna comparison, September 2026

This is an isolated experiment, not a production provider switch. It never runs
Anthropic requests, queues hotel updates, sends mail or writes production data.
Only the `run` and `verify-live` commands can buy new requests. They use the
OpenAI Responses endpoint, a fixed `gpt-6-luna` model, Standard processing, and one
local ledger with a **$20 combined ceiling**. The key is read from
`OPENAI_API_KEY` in the environment or `.env.local`, without loading other keys.

## Run and resume

From the repository root:

```text
node scripts/compare-research-models.mjs prepare
node scripts/compare-research-models.mjs test
node scripts/compare-research-models.mjs run
node scripts/compare-research-models.mjs verify-live
node scripts/compare-research-models.mjs report
```

The report, CSV, frozen manifest, settings, responses and ledger are in
`out/luna-comparison/` (ignored by Git). `prepare` is safe to repeat: it does not
overwrite the experiment. `report` makes no network requests. `test` uses fake
responses only. A changed implementation invalidates the paid-run safety gate.

There is deliberately no reset, new output directory or new budget argument.
Preserve the entire output folder. Deleting it would destroy the financial
record, not create permission for another $20. An exclusive lock prevents two
processes from spending concurrently. After a crashed process, check the PID in
`active.lock` is no longer running before removing **only that lock**. Preserve
the ledger and all reservations.

If a response is lost, the runner stops and holds its maximum charge. It records
the response ID as soon as the stream opens. Retrieve it with:

```text
node scripts/compare-research-models.mjs reconcile LEDGER_REQUEST_ID resp_PROVIDER_ID
```

Then resume `run`. If no response ID was received, use the saved provider/client
request identifier to investigate in the provider dashboard. Do not clear the
reservation or resubmit blindly. HTTP errors also retain their reservation
until their billing status is established. No automatic retries or provider
fallback are used.

An explicit HTTP 400 rejection without a response ID can be acknowledged using
`ack-rejected LEDGER_REQUEST_ID`. This **does not release its reservation** and
does not retry that request. It only permits a corrected request body within the
same ceiling. Timeouts, HTTP 500 responses and accepted response IDs cannot use
this path. The first live-search attempt in this experiment used JSON mode, was
rejected with HTTP 400, and remains reserved because its error body was not saved.
The corrected search requests ask for JSON in the prompt without enabling JSON
mode. Later HTTP errors preserve the provider's error details for diagnosis.

## What is compared

The manifest uses saved Eindhoven and Rotterdam recordings, plus the later
Eindhoven recording containing Haiku shortlisting. Up to 30 unique inputs per
task are chosen deterministically, alternating cities while both have cases.
Preparation uses approximately 20%, grouping identical page evidence so it
cannot leak into holdout. Identical requests are deduplicated. The exact
selection, omissions, source hashes and timestamps are retained.

Page extraction and demand evidence share a request; they have separate quality
metrics but **one cost**. Both responses use the existing app schema, evidence
checks, validation and demand scoring. No user overrides are applied. Venue
distances without saved coordinates remain unresolved, rather than invented.

Historical URL search snippets are encrypted by Anthropic. Their titles and
observed URLs can be replayed, but this is **not a full same-information test**.
The Haiku shortlist recordings currently cover Eindhoven only. Neither gap can
be waved away to recommend switching all Haiku work.

Live searches cover two cities, two non-overlapping date windows (today through
day 90; day 91 through day 365), and three event categories: 12 requests. They
never receive the baseline's event names. Returned official URLs must have been
observed by the web tool; the app's public-page fetcher retrieves them for quote
checks. A blocked fetch stays unresolved. Live searches are a different date and
workflow from old production searches, not a simultaneous head-to-head test.

`verify-live` freezes a separate set of pages that Luna actually discovered,
without receiving any historical event names. It reuses downloaded pages and
limits coverage to 24 sources per city and date window. Blocked pages and sources
beyond that limit are listed as omissions. Page extraction uses high reasoning
and a 16,384-token answer allowance, including reasoning. The original final-test
settings remain unchanged at 8,192 tokens, and incomplete answers remain failures.
Up to three page requests run together, with all three maximum costs reserved
before submission. Their costs remain inside the same $17 cumulative fresh-search
allowance and $20 overall ceiling. Resume the same command to reuse completed work.

## Review and decisions

The HTML report includes raw facts, supported evidence, missing and extra events,
assessment differences and shortlist disagreements. Automatic retention counts
are provisional. Sonnet's saved answer is not an answer key. Review both sides
against sources, including empty answers and cases where both models agree.

Optional `reviews.json` maps a case ID to:

```json
{
  "CASE_ID": {
    "answerHash": "hash shown in report.json",
    "status": "reviewed",
    "notes": "Explain the source-based adjudication and any changed website.",
    "evidence": [{ "url": "https://official.example/event", "quote": "An exact source passage of at least twelve characters." }],
    "expectedEvents": [{ "title": "Event", "aliases": [], "start": "2027-01-01", "end": "2027-01-02" }],
    "baselineErrors": 0,
    "lunaErrors": 0
  }
}
```

Reviews are invalidated if answers change or the cited quote is absent from the
saved pages. Missing reviews, fewer than 20 reviewed useful events, missing
city/task coverage or unresolved evidence means **insufficient evidence**. A Luna
answer that failed (for example, cut off at its answer allowance) is a measured
Luna failure: it keeps no events and is reviewed as an error. Only unsent or
unreconciled requests leave the comparison incomplete. A switch requires at least
95% retention, no increase in measured error rate, passing
wrong-year/unsupported-evidence checks, and at least 50% Sonnet savings. The
report also shows how many of the same reviewed events Sonnet itself kept, so
neither model is treated as the answer key. Haiku requires lower full task cost
as well as quality. A report is not deployment authorization.

For a shortlist review, source evidence is the original supplied metadata rather
than a web page. Use `{"kind":"metadata","quote":"exact candidate title"}`.
Source checks and publication readiness are separate: a correctly extracted
city-only event can still need venue coordinates before publication. Results
outside the tested city remain unresolved rather than being assumed nearby.

## Money and monthly estimates

Phase ceilings are cumulative: $5 for saved work, $17 including fresh searches,
$20 including repeatability. Before each request the runner reserves the maximum
allowed output/reasoning plus conservative input and tool fees. Search requests
reserve a full context at the higher long-context/cache-write price for every
possible tool turn. Usage settles the reservation only after a final response.
Failed requests with usage still cost money. Unknown usage stays reserved.

Prices were checked on 23 September 2026:

- [Luna pricing and limits](https://developers.openai.com/api/docs/models/gpt-6-luna).
- [Tool pricing](https://developers.openai.com/api/docs/pricing).
- [Responses request limits](https://developers.openai.com/api/reference/cli/resources/responses/methods/create).
- [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing).

Recorded standard Anthropic costs and batch-equivalent costs are separate. Batch
conversion discounts model processing, not search fees. Luna processing includes
reasoning exactly once. All hosted web actions are conservatively charged in the
report pending invoice reconciliation. The report does not assume a Luna batch
discount. Preparation, repeats, errors and unresolved reservations are visible
in the experiment ledger, even though the main paired comparison uses holdout.

The earlier approximately $49/month estimate was an incomplete historical
scenario. Do not divide it by a token-price ratio. A usable monthly workload must
contain one complete post-repair update per unique shared area, including broad
and long-range work once, with onboarding and manual work separate.

When that evidence exists, supply `monthly-workload.json`:

```json
{
  "complete": true,
  "source": "Reference to the reconciled complete monthly-cycle evidence",
  "areas": [{
    "area": "one unique shared area",
    "source": "Evidence for this area's complete cycle",
    "includesBroad": true,
    "includesLongRange": true,
    "sonnet": 0,
    "haiku": 0,
    "other": 0
  }]
}
```

Use real dollar values instead of the example zeros. Duplicate areas and missing
components are rejected. The report multiplies a 30-day cycle by 365.25/360 for
an average calendar month, not by the number of hotels. Replacement scenarios
apply measured task ratios and remain modeled estimates, not completed hybrid
production runs. Unknown costs stay unknown.

## Round 2: the whole search pipeline

Round 1 above is frozen. Round 2 is a separate experiment in `out/luna-pipeline/`
with its own ledger and a **$40 ceiling**. It never sends an Anthropic request:
the app runs with a dummy Anthropic key, and every Anthropic Messages request it
makes is answered by Luna (`scripts/luna-pipeline/translate.mjs`).

- The app code, prompts, validation, quote checks, scoring and publication are
  unchanged. Sonnet-role requests use high reasoning and Haiku-role requests use
  medium reasoning, both with a 32,000-token answer allowance (round 1: 8,192).
- Luna receives one extra instruction: every quote must be one unbroken passage
  from one page, and `locationText` must name the venue, hall or city.
- Anthropic's hosted page fetcher has no OpenAI equivalent. It becomes a Luna
  function that uses the app's own safe page fetcher, limited to the same number
  of pages and to URLs from the task or search results.
- The account's limit is 200,000 tokens per minute. The translator runs at most
  four Luna requests at once and waits out rate-limit rejections, which are not
  billed. The first Eindhoven run without this lost 12 near-term checks and is
  kept as `attempt1-ratelimited-*`. An empty OpenAI balance is not retried; runs
  with any failed Luna request are left out of `comparison.md`.
- The app is told its visible answer tokens only, so its own research budget
  behaves as it does for Sonnet without thinking. Real cost, including
  reasoning, is in the ledger.
- `LUNA_REASONING=none` runs the "thinking off" variant (no reasoning for any
  request, like the app's Sonnet calls). Its run folders start with `nothink-`
  and its page retest writes `page-retest-nothink*.json`.

Commands, from the repository root:

```text
node scripts/luna-pipeline/page-retest.mjs
node scripts/luna-pipeline/run.mjs eindhoven --allow-paid --reset
node scripts/luna-pipeline/run.mjs utrecht --allow-paid --reset
node scripts/luna-pipeline/sonnet-baseline.mjs
node scripts/luna-pipeline/compare.mjs
```

`page-retest.mjs` resends the 23 recorded Sonnet page-reading requests and grades
them against the round-1 hand review. `run.mjs` runs the real near-term Refresh
and the background long-range research for one benchmark market in the isolated
database `refs/luna-pipeline-db` (Docker required), starting from the same
production rows as the saved 9 September Sonnet run, then scores the calendar
against `tests/fixtures/hotel-demand-expectations.json`. `--reset` wipes only
that isolated database. `sonnet-baseline.mjs` reads the current production
calendars and recorded model usage; it can only send GET requests.
`compare.mjs` writes `comparison.md` from saved files.

The benchmark check in `compare.mjs` is applied identically to every calendar:
overlapping dates plus one shared name word, so title variants such as "Dutch
Design Week" and "Dutch Design Week 2026" count. Only events still ahead on the
Luna run date are counted. The production calendar is the result of several
Sonnet runs and manual repairs over weeks; a Luna run is one pass from the
starting rows, so the production comparison favours Sonnet. The 9 September run
is the like-for-like single pass, but on older app code.
Some live-calendar events are visible only because someone set their level by
hand (for example GLOW and Eindhoven Metal Meeting). `comparison.md` therefore
also shows the live calendar without those hand-set levels.
