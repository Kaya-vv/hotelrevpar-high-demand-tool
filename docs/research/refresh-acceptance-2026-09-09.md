# Refresh acceptance: incomplete

The human-enriched policy fixture is not evidence that Refresh discovers the same events. It must never be used as a release acceptance gate. The answer key is now separate in `tests/fixtures/hotel-demand-expectations.json` and is consumed only after reading actual calendar output.

## Observed production baseline

Read-only inspection on 9 September at 11:52 UTC found both hotel jobs still running. Actual calendar recall was Utrecht 0/9 and The Match 0/17. No selected negative controls appeared. Empty output does not establish useful precision or success.

Utrecht's background research had completed in roughly three seconds with zero provider requests, despite 32 pending repairs. Its old cycle had exhausted three waves. The market's assessment version did not reopen this work, and page extraction caches omitted the assessment version. The local fix reopens an old, non-pending cycle and re-extracts outdated cached text without resetting spending. Submitted batches retain their original manifests and drain before an upgrade on the next invocation.

Demand retrieval also ignored ordinary hotel/travel links unless they happened to score as date announcements. The local fix prioritizes observed official hotel/travel links during demand repair, using the same page allowance. Link labels do not count as demand facts: extraction and source verification still apply.

These changes are local and have not been deployed. No paid collection was started for this work.

## Repeatable production check

Run `node scripts/audit-demand-refresh.mjs` using the existing production environment file. The script permits only database GET/HEAD requests and calls the application's actual calendar query for the two hotels. It writes ignored snapshots and `refs/demand-acceptance/production-report.json`. A nonzero exit means acceptance has not passed.

Acceptance requires completed collection and background publication, all 9 Utrecht and 17 Eindhoven positives with the correct local dates, and no selected negative controls. Missing events are traced through discovery, extraction, location, verification, demand, account validation and calendar filtering. Selected controls do not replace review of additional, previously ungraded calendar events.

The script does not refresh hotels, inject evidence, change decisions, recalculate scores or submit provider work. Its report measures actual calendar acceptance, not the completeness of provider recordings.

## Replay boundary and remaining proof

`replayRecordedAnthropic` matches the complete recorded message request, including model, prompt, tools and evidence. A mismatch or an unused response fails integrity even when application code catches an exception. The older substring replay helper remains an orchestration unit-test tool. Neither helper predicts fresh search results.

A complete automatic Refresh recording is still missing. Historical event snapshots and partial provider responses cannot be reconstructed into one honestly. The full pipeline replay harness is not complete; the exact-request helper is only its provider-message boundary. Do not describe its unit tests as an end-to-end replay.

Remaining gates:

1. Review the existing automatic runs after they finish; preserve pending batches and their evidence.
2. Exercise the prepared repair changes through an automatic Refresh with unmodified inputs and retained caches. The user retains control of paid refresh initiation. Capture complete request/response and page provenance for a strict replay, including background publication.
3. Require the actual calendar benchmark to pass and review all additional included events. Diagnose each miss at its owning stage; do not add answer-key facts or force calendar eligibility.
4. Repeat the same successful configuration with caches preserved. Measure immediate reuse separately from the due weekly refresh. Report actual provider billing and coverage for each; the $1.85 cold run does not establish a warm-run discount.

Local verification covers cache-version repair, spending preservation, immediate cache reuse, pending-batch regressions, bounded hotel-link retrieval, exact-request mismatch rejection and actual-calendar acceptance logic. It establishes code behavior only. Production recovery remains unproven.
