# Eindhoven automatic validation

Status: live API evaluation in progress. No passing production claim.

## What is being exercised

The user authorized a paid Eindhoven test with batching disabled. The harness invokes `runCollection` with its default collectors and reviewers, then drains the real `processMarketWork` research/publication handlers. It reads the actual calendar query after publication. Queue delivery is local and the database is an isolated Supabase instance on port 54431 with the repository migrations applied. This is a live provider test of the application pipeline, not yet proof of the deployed website or Vercel queue delivery.

The input is the original 7 September The Match snapshot containing 84 linked events and their saved source evidence and decisions. It contains no additions from the researched answer key. The market starts without retained long-range research, so this also exercises reconstructing research from the saved hotel portfolio. That differs from The Match's current retained production market and must be stated when comparing cost or recall.

The harness records external HTTP request bodies and responses, and direct official page retrievals. Headers are omitted and credential query parameters are redacted in request URLs. Recordings remain ignored local artifacts. The answer key is loaded only after collection and publication return. Separate read-only audits can trace the stored data while collection is running.

## Application path

1. Load hotel area, source configuration, known event identities, source URLs and research seeds.
2. Reuse eligible fresh shared evidence; collect enabled direct feeds and near-term Claude discovery.
3. Resolve and fetch sources, extract quoted dates/location/demand facts, verify those quotes, geocode, validate identity/status and persist account decisions.
4. Discover and verify near-term and future editions through retained market research, with a bounded request/page budget.
5. Publish researched candidates through the same repository, then recalculate hotel demand and query the calendar.

Finding a name does not pass acceptance. A benchmark must appear with correct local dates after the real evidence, location, account-decision and calendar filters. Additional visible events need review; zero named negative controls alone is insufficient.

## Findings during the first live run

- The market worker hardcoded batching on. It now respects the same `ANTHROPIC_BATCHES=disabled` setting as the main collector. The default remains batching enabled. Tests cover both settings.
- A slow agenda retrieval reached its timeout while other requests succeeded. The normal retry/verification path continued; the harness did not manually remove that source.
- Near-term extraction returned DDW dates/location without demand facts. That is a discovery/verification result, not a successful hotel-demand calendar entry.
- Repository repair priority currently depends on legacy visibility. A hidden event can consequently lose its repair priority while remaining excluded from discovery as already known. This is under investigation against final misses.
- Long-range seed selection limits historical seeds to the current calendar year. Existing future editions without a retained market need a repair path as well; their presence in a saved hotel portfolio is not evidence that they were reverified.

## Independent review of additional discovery

Maker Days is confirmed for 12–13 September 2026. Its official site describes more than 7,000 visitors, but the reviewed visitor information establishes transport/access rather than visitor origin or overnight stays. That establishes event scale, not a hotel-demand benchmark on its own. Sources: [organizer](https://makerdays.nl/), [visitor information](https://makerdays.nl/informatie/).

No source facts from this independent review are supplied to the running collector.
