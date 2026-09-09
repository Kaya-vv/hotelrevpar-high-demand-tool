# DemandRadar optimization plan

Date: 2026-09-09. Local implementation and verification are recorded in [optimization-results-2026-09-09.md](optimization-results-2026-09-09.md). Production deployment and observation remain pending.

## Outcome and scope

Make leaving the app open inexpensive, keep pages responsive as accounts grow, and make collection progress and failures trustworthy. Deliver this as small changes with measured before/after results. Preserve hotel demand scoring, evidence requirements, account isolation, manual decisions, full-horizon exports and export deduplication.

Priorities: stop repeated heavy reads first; shrink page queries second; investigate and repair the actual timeout/worker failure paths third. Do not substitute higher database timeouts or a larger instance for those changes. Capacity changes remain an option if measured demand still requires them.

## Evidence and limits

Verified from the current checkout:

- `src/components/collection-progress.tsx` calls `router.refresh()` every three seconds while the latest batch is active, without a watch limit or visibility check. It is mounted in the shared application shell.
- `src/features/collection/use-run-status-poll.ts` independently refreshes every 15 seconds for ten minutes. Calendar and source-health views can therefore have two polling owners.
- `src/features/calendar/query.ts` loads all active account decisions, events and sources before hotel/date filtering. It uses full-row selections for those records and hotel scores.
- Calendar research status loads the full market `state`. `src/features/accounts/source-health.ts` loads all market states in both `getSourceHealthRuns()` and `getMarketResearchHealth()`; the admin page calls both.
- `src/lib/supabase/fetch-in-batches.ts` starts every 50-ID batch concurrently. It does not paginate results within each batch; one-to-many queries can still exceed the API row limit.
- Workspace and dashboard queries include broad score/decision/history reads. Several do not exhaust pagination, creating a correctness risk as data grows.
- Layout and page code both resolve authentication/account and hotel context.

Read-only production observations from the investigation immediately preceding this plan:

- Two sampled jobs remained `running`, including the newest job. Their status alone does not prove they are abandoned.
- The newest job's account had 985 active event decisions. A reproduction of the account event-loading step returned approximately 2.28 MB of decoded JSON, excluding scores, layout reads and auth.
- That measurement used administrative reads and 100-ID batches; it is not an authenticated browser trace or the app's actual query-count measurement.
- The selected market's full state response was approximately 2.13 MB. That conditional read is additional to normal event loading.
- The screenshot contains statement timeouts and normal checkpoint messages. The failing SQL and billed egress breakdown have not been retrieved.

At one successful refresh every three seconds, 2.28 MB implies about 2.7 GB/hour of decoded data. This is a workload illustration, not billed egress: wire compression, actual refresh completion and browser scheduling matter.

## 0. Establish the baseline and identify failing queries

Do a short baseline capture, without delaying the polling containment release.

1. Record deployed commit, environment, account/hotel, visible route, time window and collection state. Verify the deployed bundle contains the identified loop.
2. Capture the Supabase egress breakdown by service and time. Match PostgREST logs and Postgres timeout statements to the browser/app-server request window. Separate browser reads, workers, admin dashboards and other clients.
3. Capture a bounded browser trace for calendar, admin source health, dashboard and export. Measure initial load and visible/hidden idle behavior. Do not leave the current loop running overnight for a baseline.
4. Measure server-to-Supabase request count, duration, returned rows and decoded response bytes separately from browser transfer size and provider-billed egress.
5. Use existing Supabase/Vercel logs first. Add small, sampled application timing records only where attribution is missing: route/query label, duration, row count, result code and correlation ID. Do not log credentials, complete query results or research documents. Do not add a database write for every observed read.
6. Inspect the running jobs alongside run records, pending markers, queue deliveries and provider batch status. Preserve provider IDs and billing/reservation evidence.

Deliverable: a baseline table and identified timeout query fingerprints, or an explicit access/data gap for each missing observation.

## 1. Stop the open-tab request loop

### Immediate containment

- Remove the banner's independent three-second timer. Use one polling owner per mounted app shell, with calendar and source health consuming the same status state.
- Until the small status endpoint is ready, use at most one 15-second refresh loop, only in a visible tab, stopping after ten minutes. Provide a manual refresh and clear stale-status message.
- Clean up on navigation/unmount. Re-renders and route refreshes must not reset the watch window. A newly initiated run may start a new window.
- Pausing UI monitoring must never cancel server work or label a pending provider batch as failed.

### Replace page refresh polling with small status reads

- Add an authenticated, account-scoped status endpoint. Give platform administrators a separately authorized scope for the admin screen; never let client-supplied IDs bypass authorization.
- Return only the relevant batch/job summary, run identity, completion/publication status and a stable change indicator. Load needed scalar fields and aggregates; never event collections, full source results or market state documents.
- Base the change indicator on displayed progress and published data. A provider-check timestamp alone must not trigger a full page reload.
- Default cadence: every 15 seconds while visible and pending, with a ten-minute watch window. No scheduled monitoring requests while hidden or offline. On returning, perform one status check; resume only if the window remains open. Manual resume starts a new window.
- Schedule the next request after the previous request completes. Cancel client requests on cleanup. Back off after transient failures to 30 and then 60 seconds within the original watch window. Stop on authentication/authorization failure and show an appropriate action.
- Update banner progress in client state. Reload page data only for a relevant completion/publication change, coalescing repeated observations of the same change.
- Terminal and idle states stop polling. Do not poll historical runs forever. If an already-open idle page must discover work initiated elsewhere, add an on-focus check; automatic continuous discovery is outside this first version.
- Keep the endpoint private and uncached across users. A small response does not excuse repeating the existing heavy workspace loader inside it.

Acceptance:

- Zero scheduled collection-monitoring requests from a hidden tab; an already in-flight request is allowed to finish/cancel.
- At most 40 status requests over a ten-minute watch per visible tab, plus explicit user/focus actions.
- No whole-page refresh for unchanged status; at most one refresh for each observed relevant data-publication transition.
- Status response target: at most 5 KB decoded JSON for the current account fixture, constant query count, no bulk event/research reads. Track auth costs separately.
- Closing the browser does not affect worker completion. Manual refresh still works after watch expiry.

Primary files: `collection-progress.tsx`, `app-shell.tsx`, `use-run-status-poll.ts`, `refresh-run-status.tsx`, `calendar-view.tsx`, and a new status route/query.

## 2. Make normal page reads proportional to what is displayed

### Calendar and review

1. Resolve account and selected hotel/area first. Restrict event IDs through account-area links before loading event/source/score detail.
2. Apply the requested effective date window before fetching large detail records. Account overrides must take precedence over original dates, including events moved into or out of a window. Preserve Amsterdam date semantics, multi-day overlap and current all/3/12-month views.
3. Use explicit columns. Keep fields needed for source eligibility, announcements, approximate locations, demand display and manual overrides. Avoid fetching research text or unrelated evidence properties.
4. Prefer a scoped database join/query where it expresses these rules correctly. Introduce a narrowly scoped view/function only when the existing REST queries cannot do so cleanly; verify caller authorization and RLS behavior.
5. Preserve category/filter behavior and all publish/review gates. Filter earlier without removing qualifying rows or changing available categories inadvertently.
6. Retrieve exported indicators for the relevant hotel/event set. Keep export-history and full-horizon export semantics separate from the calendar window.
7. Keep deterministic pagination wherever result sets can exceed the API row cap. Do not replace correct exhaustive reads with an arbitrary limit.

### Research and admin source health

- Read projected status properties from existing market JSON rather than full state. Start with a query projection; introduce persisted summary columns only if measurement shows projection CPU remains significant.
- Share the same small market summary within a source-health request. Eliminate the duplicate whole-market fetch.
- Return a paged run summary. Fetch detailed rejection lists, evidence and usage breakdowns when the administrator opens a run.
- Aggregate usage totals server-side and ensure counts remain correct beyond the API row cap.
- Maintain current `researchIsPending` behavior, including publication timing and historical runs; a later research request must not reopen already published historical work.

### Workspace, dashboard and export

- Reuse authentication/account and hotel scope within a single render/request, with explicit account and selected-hotel dependencies. Do not introduce a cross-user persistent cache.
- Compute review badges from eligible scoped records or a database aggregate rather than transferring every score on every page. Preserve the publishability gate.
- Fetch the latest job/run per relevant area in the database instead of loading all historical rows and using `find` in JavaScript.
- Scope export data to selected hotels before large source/score reads. Preserve full-horizon selection, inactive-history behavior, manual export levels, previous-export exclusions and explicit re-export.
- Replace full-row export/history selections where fields are unused. Generate/download workbooks on demand; never include workbook content in status or listing responses.

Acceptance:

- Identical visible events, review counts and export selections on parity fixtures, including overrides and more than 1,000 records.
- No full market-state transfer for UI status or summary pages.
- At least 80% fewer decoded database bytes for the measured calendar fixture; investigate any remaining large fields. This is a target to verify, not a claimed result.
- Adding unrelated account events does not increase the selected hotel's detail payload. Larger requested horizons may legitimately return more data.

## 3. Reduce database contention and fix the actual timeouts

- Reproduce captured timeout statements using the same authorization role, filters and representative volume. An administrative query's speed is not evidence of RLS-user performance.
- Inspect query plans, current indexes, row estimates, locks, database resource pressure and RLS membership checks. Start with non-executing plans in production; run expensive executed plans on representative staging data or a bounded approved diagnostic window.
- Consider account/latest-job ordering, per-area latest-run lookup, scoped link access and effective-date filtering as candidates. Add an index only when a measured plan needs it; existing event/source/score indexes must be considered first.
- Limit simultaneous batches in `fetchInBatches`; begin with four in flight and tune against measured latency and database load. Preserve error propagation and deterministic results. This addresses the concrete all-batches-at-once burst.
- Audit one-to-many callers: 50 input event IDs do not guarantee fewer than 1,000 source rows. Paginate within batches or replace those reads with a correctly paged scoped query.
- Preserve existing worker concurrency of two while measuring. Check database connections and aggregate load across workers and browser requests before changing concurrency.
- Inspect the configured 900-second queue visibility timeout against possible 1,800-second executions using the installed queue documentation and delivery logs. Verify whether renewal/claim behavior prevents overlapping deliveries before proposing a change.

Acceptance: no reproduced `57014` from the targeted page/status workload after optimization; bounded in-flight batch count; authenticated query plans and results recorded; index migrations have a deployment/rollback procedure and do not remove authorization checks.

## 4. Make long-running work and recovery trustworthy

- Distinguish active execution, waiting on a provider, awaiting publication, completed/partial and failed in the UI using existing persisted evidence wherever possible.
- Audit status writes in `jobs.ts`: several awaited updates do not inspect the returned database error. Ensure failures to persist pending or terminal states are surfaced, so an acknowledged delivery cannot silently leave an incorrect running state.
- Review queue expiry, retry exhaustion, killed workers and publication failures together with existing idempotency and lease mechanisms. Repair a demonstrated gap using those mechanisms before adding another scheduler or recovery system.
- Diagnose the two observed running jobs individually. Do not infer failure from age alone, cancel accepted provider work, erase cache rows or submit replacements without reconciliation.
- Reuse saved provider batch IDs, intermediate results and budget reservations during recovery. Persist results independently so one failure cannot discard successful work.
- Add a last-progress field only if existing timestamps cannot distinguish healthy waiting from abandoned execution. Record real transitions rather than writing on each browser poll.
- Audit worker state transfer volume after frontend reductions. Keep full research documents on worker paths where needed; remove demonstrably redundant reads without changing research cadence, provider selection or evidence gates.

Acceptance: fixtures for pending continuation, worker termination, status-write failure, duplicate delivery, message expiry and publication failure converge to correct visible states without duplicate paid submissions or lost successful results.

## 5. Improve responsiveness and operational visibility

- Keep the last successful page visible when a status read fails, with a concise stale/error message and retry control. Do not turn a transient status failure into a blank calendar.
- Preserve keyboard access, focus and announced progress without making screen readers announce an unchanged banner every poll.
- Profile route transfer size and client rendering after data-read fixes. Move bulky closed-panel details to on-demand reads where they dominate. Investigate route prefetching only if traces show significant speculative work.
- Record compact per-route/query timings and query errors through existing logging. Review actual Supabase database egress independently of JSON payload estimates.
- Set an initial operational alert on a sustained doubling of the normalized post-fix egress baseline, and on recurring timeout fingerprints. Normalize by active users/collection work; tune after observing normal activity.
- Document a short runbook: open-tab spike, query timeout, stale running job, provider wait, publication failure and rollback. Include the relevant evidence to collect before retrying work.

## Verification and release sequence

Deliver in this review order:

1. **Polling containment:** one bounded visible-tab owner, expiry/manual refresh UI, timer lifecycle tests. Small independent release.
2. **Small status reads:** authorization, projected research status, shared polling integration and publication-change tests.
3. **Scoped page reads:** calendar/review first, then workspace/dashboard/admin/export; parity and pagination tests per path. Keep unrelated paths in separate commits/PRs.
4. **Database and worker fixes:** only the indexes/recovery changes justified by diagnostics, with role-specific tests and provider-resume fixtures.
5. **Measured follow-through:** payload/render tuning, runbook and observed production results.

For touched code run `pnpm.cmd typecheck`, relevant Vitest tests and `pnpm.cmd lint`; complete a production build for route/component changes. Read the installed Next.js guides before implementation and consult current library documentation for new framework/database/queue API behavior. Use the repository's existing test conventions.

Required behavioral tests:

- Hidden/visible/offline transitions; no duplicate timers across re-renders; slow and failing requests; unmount; expiry; new run; terminal state; one refresh per publication change.
- Foreign account/hotel/run access denied; administrator scope enforced; no cached user data crosses accounts.
- Date overrides across month boundaries and Amsterdam DST; multi-day events; empty accounts; category filters; source disablement; High/Peak and announced gates.
- More than 1,000 decisions, multiple sources per event and more than 1,000 rows within an ID batch; counts and exports remain complete.
- Full-horizon export deduplication/re-export and publication parity before/after query changes.
- Existing provider continuation/recovery tests plus the named persistence/expiry failures above.

Use replay fixtures/local data for sustained tests, without new paid research submissions. Run a 60-minute open-tab soak on the changed build: visible pending, visible terminal, hidden, several tabs and a concurrent worker fixture. Confirm the monitor stops at ten minutes and hidden tabs issue no scheduled polls. Then verify a deployed release with an authenticated bounded trace and a 24-hour production metrics comparison under ordinary traffic. Claim local and production verification separately.

Initial performance targets, to validate against the baseline:

| Measurement | Target |
| --- | --- |
| Hidden/terminal collection polling | Zero scheduled status requests |
| Visible unchanged pending work | At most 40 small reads per ten-minute watch; zero page refreshes |
| Status decoded response | At most 5 KB on current fixture |
| Status latency | p95 below 500 ms excluding cold starts, measured in deployment region |
| Calendar decoded database bytes | At least 80% reduction on the same fixture |
| Unchanged open-tab database bytes | At least 95% reduction over the bounded baseline workload |
| UI status research documents | Zero full-state reads |
| Calendar usability | p95 usable within two seconds on the agreed representative browser/network |
| Targeted database timeouts | Zero in the soak; no recurrence of the identified query fingerprints in the production observation window |

If a target fails, record the measured reason and remaining owning query before expanding scope. Do not relax correctness to meet a byte/latency target.

Use additive database migrations and retain old read compatibility during rollout. Deploy schema dependencies before callers. Roll back a failed query/worker change independently while retaining the polling containment where possible. Do not remove evidence, caches or export history as an optimization rollback.

Before each release perform a simplification pass: remove duplicate status logic, generic abstractions with one caller, speculative indexes and temporary diagnostic artifacts; record any guarantee lost by a proposed removal.

## Optional later work, only if measurements justify it

- Cross-tab coordination if multiple visible tabs remain a material cost after small bounded status reads.
- Realtime/SSE if the product needs faster updates than polling provides; assess connection and egress cost first.
- Persisted research summaries or split research storage if JSON projection still causes significant database CPU/IO.
- Persistent caching or precomputed dashboard aggregates if scoped queries remain slow; define invalidation and account boundaries before implementation.
- Retention/archival policy for old research/usage data only after audit, resume and billing needs are established. No automatic deletion in this plan.
- Database capacity or region changes only after query improvements and measured resource/latency evidence.

## Documentation references

- Installed Next.js refresh behavior: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-router.md`.
- [Next.js useRouter](https://nextjs.org/docs/app/api-reference/functions/use-router): route refresh re-fetches server data and re-renders Server Components; it does not itself invalidate server caches.
- [Supabase egress](https://supabase.com/docs/guides/platform/manage-your-usage/egress): distinguish database egress from other service traffic.
- [Supabase timeouts](https://supabase.com/docs/guides/database/postgres/timeouts): identify timed-out statements before changing limits.
