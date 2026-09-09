# Optimization implementation and verification

Status: implemented locally; not deployed. Measurements below use production data through bounded read-only queries, not a deployed browser session.

## Implemented

- Replaced independent page-refresh timers with one shell-owned monitor. It requests a private status endpoint every 15 seconds while pending and visible, stops after ten minutes, pauses offline/hidden, prevents overlapping requests, times out stalled requests, backs off transient failures and stops on expired authorization. Explicit resume and on-focus checks remain available.
- Unchanged status and count-only progress updates do not reload page data. Relevant completion/failure/publication transitions cause a refresh. New batches/selected hotel changes get a new watch; retry-created run rows within the same batch do not extend it.
- Added an authenticated status route deriving its account and hotel from the session. Platform-wide monitoring requires the platform-admin role. It returns counts and a small revision, not events or saved research documents.
- Added a provider-wait indication based on persisted pending markers. Pausing browser monitoring never cancels research.
- Calendar/review loaders scope to linked hotel events first, select required columns, and apply effective override dates before fetching sources and scores. Calendar export badges load only relevant event claims.
- Export loaders scope to selected hotels and effective dates while retaining canonical historic claims, full-horizon selection, deduplication and explicit re-export behavior.
- Dashboard reads the latest job/run per area through limited embedded queries. Review badges fetch scores only for linked review candidates. Shared account/hotel context is memoized within a server render, not persistently across users.
- UI research checks use JSON field projections. Admin market summaries share a request-cached projection instead of loading every full document twice. Run history uses projected summaries, paged 20 records at a time. Rejection details and per-run usage are fetched only when an administrator expands a run. Expanded details retain last-success lookup through a small status-only history query.
- Query batches run at most four at a time per helper invocation. One-to-many UI/usage reads exhaust pagination inside each ID batch instead of assuming that 50 IDs imply fewer than 1,000 result rows.
- Collection-job writes now inspect database errors. A failed status write is surfaced to the queue; a failed success write is not relabeled as a provider failure. Existing provider identity, continuation and queue mechanisms remain in place.
- Added a repeatable, read-only benchmark script: `node scripts/benchmark-ui-reads.mjs --production-read-only`. By default it uses the local database. It refuses non-database destinations and all writes.

## Measurements

Compared with baseline commit `cc5187d9843c3110089158c01d1ba7bae076706c`, using the same account data and selected hotel in each comparison on September 9.

| Calendar workload | Before DB bytes | After DB bytes | Reduction | Before/after queries | Visible events |
| --- | ---: | ---: | ---: | --- | ---: |
| Hotel A, month | 2,331,538 | 78,303 | 96.6% | 47 / 9 | 0 / 0 |
| Hotel A, full horizon | 2,331,538 | 178,771 | 92.3% | 47 / 12 | 0 / 0 |
| Hotel B, month | 2,318,593 | 69,040 | 97.0% | 47 / 9 | 3 / 3 |
| Hotel B, full horizon | 2,318,593 | 144,828 | 93.8% | 47 / 12 | 18 / 18 |

The second hotel's individual loader calls took 953 to 429 ms (month) and 797 to 503 ms (full horizon). These are single samples, not p95 performance claims.

Both hotel comparisons retained the same output values and event order. Source-link sets are identical; their previously unspecified ordering is now deterministic to support safe pagination.

The initial small-status benchmark returned 289 bytes and read 310 bytes across three database queries. The final provider-wait field adds a small boolean and pending-marker read. Authentication and selected-hotel lookup costs are additional, as are research projections when required. These are decoded JSON measurements, not Supabase billing totals or compressed wire bytes.

## Verification

- Full unit/component suite: 365 passed, 15 skipped. Ten database integration cases were separately enabled and passed against the isolated local PostgreSQL instance; the other opt-in suites were not run.
- Ten isolated PostgreSQL integration tests passed, covering export transactions/deduplication, canonical merge history, authenticated account isolation, date overrides, dashboard embedded latest-job reads and compact research-status JSON projection.
- TypeScript checking, application/benchmark-script lint and the production build passed.
- Timer tests simulate an hour of pending work, including re-rendering, hidden/offline transitions, duplicate interested views, errors, authorization expiry, publication coalescing, explicit resume and unmount cancellation. This is simulated time, not a physical hour-long browser soak.
- Repository-wide lint has an existing error in ignored `refs/scoring-review/replay.mjs`: assignment to `module`. Application and benchmark-script lint are checked separately. No unrelated replay code was modified.

Docker Desktop was started to run the existing isolated database test suite. The existing pending-marker migration was applied to the isolated evaluation database because it was behind production; no production schema changes were made. Test fixtures remove their own temporary accounts/events/market records.

## Production job evidence

A final bounded read found both running jobs had recent `pending_since` checkpoints. Recent provider-cache records retained provider IDs and reported processing, without stored errors. This supports ongoing provider-wait continuations; age alone does not establish abandoned work. Direct provider/queue reconciliation was not performed, and no jobs or batches were restarted or cancelled.

The installed queue SDK automatically renews message visibility. The 900-second visibility setting versus 1,800-second function duration therefore does not, by itself, justify a configuration change.

## Remaining release and investigation gates

1. Deploy the reviewed code, verify its exact revision, and capture an authenticated browser trace. No schema migration is required by these changes.
2. Confirm hidden tabs issue no scheduled status traffic and unchanged pending views issue no repeated full-page requests on the deployed app. Verify manual resume, hotel switching, logout, source-health pagination and export downloads.
3. Observe normal production usage for 24 hours, separating database egress from other Supabase services. The billing dashboard and exact timed-out SQL were unavailable in this session. Do not infer billed savings or elimination of the screenshot's timeouts from these benchmarks.
4. Retrieve the actual timeout statements and authenticated query plans before adding indexes or changing database capacity/timeouts. No speculative indexes or capacity changes were made.
5. Usage aggregation now runs on the server over fully paged rows for the explicitly opened run. A database aggregation RPC was unnecessary to remove the initial page's usage transfer and would introduce a schema deployment dependency. Consider it only if a single run's measured usage history becomes a bottleneck.

## Review and rollback

Review order: status query/authorization; monitor lifecycle; calendar/export parity and pagination; dashboard/workspace summaries; job persistence; tests/benchmark.

The simplification pass kept existing Supabase queries, React request memoization and Vercel queue renewal. No new runtime dependencies, background scheduler, persistent user-data cache, realtime subscriptions or research-storage migration were introduced. Data retention, scoring/evidence gates and provider calls are unchanged.

Roll back independent query or worker changes while retaining the removal of unbounded polling wherever possible. If the status endpoint fails after deployment, it should back off and keep the last page visible; users can refresh manually. Do not restore the three-second loop as a fallback or delete saved research/export history.

## Operational checks

- **Traffic spike:** record deployed revision, route, visible/hidden state and active batch; compare browser requests with server-to-Supabase requests. Group Supabase errors by statement fingerprint rather than checkpoint log count.
- **Status failure:** check auth/HTTP result, query error and whether a request timed out. Repeated 401/403 requires a fresh authorized session; do not retry indefinitely.
- **Long-running job:** inspect job pending timestamps, run completion, queue delivery/expiry and saved provider IDs together. Recent provider-wait checkpoints are different from missing delivery progress.
- **Timeout:** capture the SQL/role and inspect its plan, locks and resource pressure. Administrative query timings do not validate RLS-user performance.
- **Egress:** compare like-for-like active users and collection work. Investigate sustained growth relative to the post-deployment baseline; alerts still need to be configured in the provider's operational dashboard.
