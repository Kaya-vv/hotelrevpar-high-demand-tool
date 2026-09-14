# Scoring and verification recovery: revised plan

Status: planned, not implemented. Updated September 14 after inspecting the three festival failures. This update authorizes plan changes only, not implementation, paid tests or production changes.

## Finish within a fixed scope

- Prioritize the three general fixes below. They must work across hotels and events; no festival-name exceptions, hardcoded official URLs or automatic High ratings.
- Pause additional paid testing. First use saved production responses and downloaded pages to reproduce failures offline. Missing recordings are an explicit limit on what can be proved, not permission to substitute assistant research.
- Review order: source-URL correction first, first-check scheduling second, evidence completion third. Test each independently before combining them. Keep the earlier near-term recovery and sports proposal separately reviewable and deferred from this first delivery.
- Success means more independently verified, useful calendar results without losing existing good results or increasing the agreed spending limits. Manual demo additions do not count as automated success.

## Protect the existing calendars

- Freeze a fresh read-only baseline for all 11 hotels in the populated HotelRevPar account before implementation: effective calendar entries, dates, scores, source evidence, manual decisions and export history. The September 14 inspection found 108 visible hotel entries: 86 High/Peak and 22 announced. Counts include shared events and existing duplicates.
- Keep competition-feed handling unchanged. The football-data source specifically requests Champions League matches. Nine visible hotel entries across four hotels depend on that path; do not require a new evidence field on legacy feed records.
- Defer broad football classification, category normalization and removal of existing marquee exceptions. Regular Eredivisie matches must not gain eligibility through the new sports exception, even with hotel-booking evidence. Do not broaden existing football eligibility.
- Preserve manual demo ratings until the owner reviews automatic results. Do not bulk rescore production, refresh every hotel, change existing batches or alter export history.

## Three general fixes

### 1. Recover malformed source URLs using already-fetched evidence

- Observed failure: Concert at SEA's official 2027 pages were downloaded, but Claude appended `/attendance:null,` to its returned source URL. The unfetched URL was correctly rejected. A later attempt returned to the tourist-listing URL and encountered a connection reset.
- On a source-URL validation failure, allow at most one correction attempt using only the already-fetched official pages. The corrected URL must exactly match a supplied page, and its event identity, edition, dates and quoted facts must pass the existing checks. Do not blindly strip suffixes, invent URLs or accept a matching domain as proof.
- Preserve an established official retrieval target independently of whether event extraction succeeds. Keep discovery listings as history; do not let them displace an established organiser source. Download success alone does not establish ownership.
- Use existing request budgeting and diagnostics. No recursive correction or additional network research in this correction step. An ambiguous or unsuccessful correction stays unresolved and preserves valid prior evidence.
- Offline acceptance: reproduce the actual malformed URL, recover it only with matching fetched evidence, and reject plausible but unfetched URLs, wrong editions and conflicting quotes. Verify subsequent work selects the established official target.

### 2. Give unchecked leads a first attempt before repeated follow-up work

- Observed failure: Enschede contained 92 leads; the cycle admitted 60 and finished after five rounds. Freshtival was outside the admitted set and received zero verification attempts. This was scheduling exclusion, not a failed download.
- Compare the existing queue with a policy that gives due, unchecked leads a first verification opportunity before repeated deepening of checked leads. Preserve category fairness and already-submitted work; do not prioritize names from this demo.
- Keep unprocessed leads and unfinished evidence work explicitly queued across cycles. Record why work stopped and its next eligibility. A completed cycle must not imply every discovered lead was checked.
- Keep the existing 60-lead, five-round and spending limits initially. First test whether ordering and existing continuation can improve coverage within those limits. If limits still prevent useful first-run coverage, report that result and propose a separate bounded change; do not silently enlarge the cycle or reopen it indefinitely.
- Offline acceptance: replay the original queue, show whether Freshtival receives a first attempt, and measure first-check coverage, completed strong candidates and time to first useful result. Reject an ordering change that merely trades the festival miss for unexplained losses or delayed strong results. Include more-than-60-lead and exhausted-budget cases.

### 3. Combine verified evidence and research the specific missing facts

- Observed failure: Onder De Radar's dates and venue were extracted, but subsequent work read airport contact material and a 2014–2018 news archive without useful hotel-demand evidence. Its homepage was split into seven chunks, four processed; separate leads handled different parts, including an address without dates. Its automatic score remained Medium. The final generic retrieval error is not fully attributed to a specific response and must not be treated as proof the official site was blocked.
- Reuse verified date, identity and location facts when processing another chunk or a duplicate lead for the same event edition. Preserve source URLs, checked dates and evidence scope. Use existing identity handling; do not combine events by similar names alone, overwrite conflicting editions or treat an organiser's office as the venue.
- Once dates are established, select follow-up work by the missing fact: venue address when location is unresolved; audience size, origins or accommodation when hotel demand is unresolved. Do not repeatedly ask general venue archives to rediscover an already-confirmed edition.
- Use the existing bounded deep-search and page allowances. Do not add an extra retry layer. Keep current edition checks, historical-evidence applicability, camping distinctions, radius checks and scoring thresholds unchanged.
- Offline acceptance: join valid facts across recorded chunks for the same edition; reject cross-year, different-venue and similarly named-event combinations. Preserve successful facts after failed follow-up. Demonstrate that demand work seeks relevant sources rather than repeatedly extracting dates. If no suitable demand evidence exists, retain the gap rather than force High.

## Earlier proposals retained as separate follow-ups

### A. Bounded near-term recovery

- Preserve initial discovery and successful verification requests/results. Add event identity only to recovery requests; do not change successful-path prompts in this patch.
- Recover after a usable response fails official ownership, essential event facts or fetched-evidence validation. Reuse the discovered name, date, location and attempted URL as search guidance, never proof.
- One recovery per distinct failed event; at most four per run, in existing discovery order. Each attempt permits one search and two official fetches. Use remaining search allowance and remaining execution time only; do not reserve slots by displacing original discovery. No recursive retries or budget increases.
- Apply identical source ownership, verbatim evidence, current edition, cancellation, location/radius and publication checks. Skip confirmed cancellations and explicit contrary hotel-demand evidence. Failure stays unresolved, not cancelled.
- Include recovery outcome, missing facts, attempted URLs and usage in existing diagnostics. Follow existing publication and duplicate handling; do not replace valid saved evidence with an unsuccessful recovery.

### B. Narrow non-football sports ceiling exception

- Release only the routine-sports total-score ceiling when the event is positively identifiable as non-football from verified source evidence and the existing hotel-demand assessment is supported/probable. Unknown sport remains on the old path; club names or AI assertions alone are insufficient.
- Keep the impact ceiling of 45, High threshold of 70, all other scoring restrictions and category handling unchanged. No new competition-evidence requirement for existing sources.
- Existing-input checks: Kustmarathon 69 to 75; Hellendoorn 65 unchanged; Military Boekelo 75 unchanged. These are manually prepared scoring fixtures, not autonomous-discovery evidence.
- The read-only September 14 simulation found no score changes from releasing the sports ceiling on the current HotelRevPar saved inputs. Recheck with the final implementation and a fresh snapshot.

## Verification and release gates

- Test each general fix separately before combining them. Keep the earlier recovery and sports changes out of these comparisons unless separately approved for implementation. Test Eredivisie counterexamples with travelling supporters, hotel bookings and big-club opponents; preserve Champions League feed behaviour and existing non-sports results.
- Cover aggregator recovery, missing dates/location, old editions, wrong cities, unfetched quotes, cancellations, duplicate leads and exhausted budgets. Confirm failed recovery cannot invalidate a successful saved result.
- Replay the complete HotelRevPar baseline through calendar publication. Any entry removal, date/score change or manual/export change needs explanation and review; do not silently bless differences as new snapshots. Separate pre-existing inconsistencies from new differences.
- Start with the saved search responses, batch results, page text and queue state from TerDuin and Bad Boekelo. Include both near-term and long-range paths. Exclude assistant-added events, evidence and ratings; expected event names belong only in evaluation. Use original pre-run state where available and disclose any reconstructed state.
- Replay offline with networking disabled. Match recordings to the actual requests; a changed request without a matching response is unproven. Use controlled fixtures to test correction and scheduling mechanics, but report them separately from evidence of autonomous discovery. Missing required recordings fail the relevant proof, not necessarily the implementation.
- Include Freshtival, Onder De Radar and Concert at SEA as explicit cases: report discovery, first attempt, date/location verification, demand evidence, automatic score and calendar visibility separately. Include the other previously reviewed demo events and the complete 11-hotel baseline. Manual High ratings are not automatic expected scores; any claimed High result must earn it under unchanged evidence rules.
- Only after offline results are reviewed, request approval for one capped live onboarding evaluation covering the two original hotel settings and both search horizons. Freeze expected outcomes, a numeric time-to-first-result target and an end-to-end deadline before spending. No paid execution is authorized by this plan update.
- Proposed maximum remains EUR 8 per hotel, EUR 16 combined, subject to that approval; do not increase it if the broader evaluation does not fit. Track reservations and actual usage, including pending batch charges. No automatic reruns or production publication. If it fails, diagnose the saved recording before proposing another paid test.
- Kustmarathon and Military remain the earlier near-term recovery targets; Hellendoorn remaining Medium is acceptable. A miss is a failed outcome, not an invitation to insert evidence. Original historic success remains unprovable without the missing original recordings. Offline success proves handling of recorded evidence; the approved live evaluation must separately establish unaided retrieval and publication.

## Babylon and morning-run findings: separate follow-up

- Babylon searches Heerhugowaard within 25 km. Its September 10 near-term run discovered 38 names, recorded 7 verified pages, 16 verification-stage drops and zero demand-accepted results. Four returned candidates lacked coordinates. The source nevertheless recorded success, which starts the existing 30-day scheduled-discovery interval.
- September 14 at 07:11 Amsterdam time: the hotel update skipped near-term Claude, read 59 saved long-range candidates, counted 16 without coordinates and published no High/Peak results. Other source requests still ran.
- Its completed long-range work cycle started September 11, exhausted five allowed rounds and remains closed until September 18 eligibility. Fifteen leads are overdue. Recorded monthly research spend is approximately EUR 3.38 of EUR 8, with no outstanding reservation; the weekly work allowance, not monthly spend, is the binding limit.
- Examples of hidden stored events include 40UP (69), Mixtream Festival (68), Cool Bluesfestival (56) and theatre/concert listings without supported hotel demand. Three long-range demand-accepted editions are in Utrecht, Maastricht and Gorinchem, outside Babylon's radius. Empty results do not establish that no suitable local events exist.
- Recovery alone will not resolve missing coordinates or reopen an exhausted weekly cycle. The general queue and evidence-completion fixes above may help these failure classes, but Babylon improvement must be demonstrated separately. Broad scheduling-frequency changes and reopening exhausted cycles remain excluded; do not increase limits merely to fill the calendar.
- Recommend a separately reviewed status-label change: distinguish fresh AI search, saved results reused, and research deferred with next eligibility. Keep completion status separate from calendar coverage. Do not call zero-token reuse a fresh successful search.

## Explicit exclusions

No changes to production data, Supabase schema/templates, general scoring thresholds, normal search frequency, monthly budgets or current live batches in this plan. Existing duplicate/date issues in Utrecht and Rotterdam are recorded separately and are not automatically cleaned up by this work.
