# Automated 90-Day Event Discovery

Date: 2026-09-01
Status: Approved direction, revised for city-independent discovery

## 1. Goal

Replace the broad 12-month collection strategy with an automated rolling 90-day demand calendar. Hotel managers receive a finished calendar and RevControl export. They do not review event candidates.

The design must work without PredictHQ. PredictHQ may remain an enrichment source if its response confirms acceptable pricing and rights for storage, combination, subscriber display, export, attribution, and AI transfer.

## 2. Product Decisions

- Search 90 days ahead and run collection once a week.
- Show events with Medium, High, or Peak hotel-demand scores.
- Keep Low and weakly supported events out of subscriber views and exports.
- Keep source conflicts in quarantine and report their count to platform health screens.
- Use Claude for bounded open-web discovery and extraction from official event-owner pages.
- Use Ticketmaster, government data, and UEFA data as category-specific supplements.
- Reuse the existing per-hotel source controls. Do not build an old-version versus new-version mode.
- Replace the existing shallow Claude search in place. Do not maintain two Claude collectors.

## 3. Source Hierarchy

### 3.1 Main discovery layer

Claude runs bounded open-web searches for the requested city and date window. Split discovery into focused category groups:

- conventions, exhibitions, conferences, and major education events;
- concerts, festivals, arena events, and stadium events;
- national or international sports events.

Do not configure domains per city. A venue calendar, municipal agenda, destination-marketing site, or ticket listing may reveal a candidate. Search must request an event page from the organiser, venue, club, university, federation, or municipality, and the final gate must reject candidates without that evidence.

Fetch each candidate page and accept the event only when the page confirms its title, date, location, and demand evidence. Store successful source URLs through the existing event-source records. Later weekly runs refresh a bounded set of those URLs and also run fresh searches, so a new city can start without source setup and established cities retain useful source history.

### 3.2 Supplementary structured sources

- Rijksoverheid and OpenHolidays supply school and public holidays.
- Ticketmaster supplies ticketed entertainment in locations covered by its API when its terms permit the intended commercial use.
- UEFA supplies published competition windows and later confirmed fixtures.
- PredictHQ supplies enrichment after written permission and acceptable pricing.

No single provider defines the calendar. Region-limited supplementary sources may be skipped outside their coverage; Claude discovery must not require them.

## 4. Collection Flow

For each hotel area:

1. Build the rolling window from today through day 90.
2. Refresh stored source pages for active events inside that window. Update confirmed dates, locations, postponements, and cancellations.
3. Run bounded open-web searches in focused category groups: business and education, live entertainment and festivals, and major sports.
4. Fetch candidate pages and retain only events supported by an official event-owner page.
5. Extract structured title, start, end, location, category, source URL, and demand evidence.
6. Normalize and deduplicate candidates across all enabled sources.
7. Apply the evidence and demand gates.
8. Persist accepted events and calculate hotel-specific scores.
9. Record source counts, failures, token use, web searches, and fetches.

Limit each search and fetch phase to a fixed request budget. Carry undiscovered future events into the next collection cycle through the rolling window instead of expanding one run without a bound. Do not reject a city because the application has no preconfigured domains for it.

## 5. Automated Evidence and Demand Gate

A non-holiday event from any source may enter the subscriber calendar when all conditions pass:

- An observed official source URL supports the record. Provider metadata alone does not meet this condition.
- The source confirms title, date, and location.
- The event falls inside the hotel's area and 90-day window.
- No unresolved duplicate, date conflict, or venue conflict exists.
- The source supports at least one demand signal.
- The hotel-specific score reaches Medium, High, or Peak.

Accepted demand signals are:

- published attendance;
- published venue capacity;
- an official description of a multi-day conference, trade fair, festival, or national or international competition;
- an official holiday or school-vacation rule.

Claude general knowledge and the current default 20 impact points do not qualify as demand evidence. Ticketmaster or PredictHQ presence alone does not prove hotel-demand impact.

Discard candidates with missing evidence or Low demand. Quarantine conflicts without placing a task in the hotel manager's workflow.

## 6. Subscriber and Platform Experience

Subscribers see:

- the automated Medium-or-higher demand calendar;
- evidence links and demand-score explanations;
- RevControl export for active events;
- source freshness without a candidate-review queue.

Platform administrators see:

- source status and last successful run;
- quarantined conflict counts;
- discarded, accepted, duplicate, and failed-source counts;
- Claude usage and cost totals;
- the existing per-hotel source controls.

Platform health information must not require event-by-event decisions. The system omits unresolved candidates from subscriber output.

## 7. PredictHQ Transition

Start the Claude-focused 90-day pilot without waiting for PredictHQ.

Keep PredictHQ behind its existing source checkbox. Do not send PredictHQ records to Claude, display them to subscribers, or export them until written permission covers those actions. Use PredictHQ for internal comparison only when its trial terms permit that use.

If PredictHQ approves the use case and the price fits the product, enable it as enrichment. If PredictHQ declines or remains uneconomic, leave it disabled. The rest of the collection flow stays unchanged.

## 8. Pilot Comparison

Freeze a known-event benchmark before the first run using Robert's existing calendars, exports, and known high-demand dates. This creates a one-time pilot check and no subscriber workflow.

Run four collection cycles over the same 90-day window. Prepare one aggregate report rather than adding review work to the product.

Compare:

- unique Medium-or-higher events by source;
- coverage of a fixed known-event benchmark;
- unsupported or irrelevant events that reached the calendar;
- source and verification failures;
- cost per accepted event;
- events contributed only by PredictHQ, when a permitted comparison exists.

The report supports the later PredictHQ decision. Do not claim Claude matches PredictHQ recall before the comparison supplies evidence.

## 9. Failure Handling

- Let one failed source produce a partial run while other sources finish.
- Keep prior confirmed events during a source outage.
- Exclude cancellations and removed events after an official source confirms the change.
- Hide unresolved conflicts from subscribers.
- Record search and fetch failures in platform health.
- Keep credentials and provider response bodies out of client-visible errors.

## 10. Verification

Add focused checks for:

- the 90-day window boundary;
- open-web Claude search and request budgets;
- discovery for a city with no preconfigured source list;
- official-source title, date, and location confirmation;
- rejection of non-holiday events that rely on default impact points;
- automatic inclusion at Medium or above;
- automatic exclusion below Medium;
- conflict quarantine without subscriber review work;
- PredictHQ-disabled collection;
- source provenance and comparison counts;
- refreshes of stored source pages, cancellations, and changed dates.

Run the full tests, typecheck, lint, production build, and diff check before completion.

## 11. Simplification Pass

This design skips:

- a permanent version-mode framework;
- a second Claude collector;
- subscriber event review;
- a city-specific source registry or administration interface;
- another commercial event aggregator;
- a separate worker service or machine-learning demand model.

Add a longer search horizon after the pilot shows that 90 days gives managers too little lead time. Add source configuration only if measured search failures show that open discovery plus stored successful URLs cannot cover a recurring source.
