# HotelRevPar High Demand Tool Pilot Runbook

Record the evidence for each gate before calling the data-quality demo ready. Deployment and RevControl import remain later milestones.

| # | Release gate | Date | Operator | Result | Link or file |
|---:|---|---|---|---|---|
| 1 | Configure local Supabase, Ticketmaster, and Anthropic secrets. |  |  |  |  |
| 2 | Keep Testhotel unchanged. Add `Demo Eindhoven` at Vestdijk 5 with a 25 km radius and South holiday region, plus `Demo Rotterdam` at Weena 10 with a 25 km radius and Middle holiday region. |  |  |  |  |
| 3 | Enable Claude, Ticketmaster, Rijksoverheid, and OpenHolidays. Disable PredictHQ on both demo hotels. |  |  |  |  |
| 4 | Freeze the event benchmark below, then run one manual 90-day collection per demo hotel. |  |  |  |  |
| 5 | Confirm Claude made twelve real web searches: four categories in each of three 30-day slices. |  |  |  |  |
| 6 | Require every in-window Peak benchmark and at least 80% of High benchmarks for each city. |  |  |  |  |
| 7 | Confirm every displayed event is confirmed High/Peak, has a current official page, and has defensible hotel-demand evidence. |  |  |  |  |
| 8 | Confirm Medium, Low, default-basis, provisional, unsupported, disabled-source-only, conflicted, and duplicate events stay out of subscriber output. |  |  |  |  |
| 9 | Confirm routine league fixtures remain below High and all-day placeholders receive no duration or late bonus. |  |  |  |  |
| 10 | Confirm PredictHQ contributes no score, source link, visible event, or export row. |  |  |  |  |
| 11 | Record the billed Anthropic cost for each hotel run and require no more than €2 per run. |  |  |  |  |
| 12 | Confirm RLS isolation tests, full tests, lint, typecheck, production build, and diff check pass. |  |  |  |  |
| 13 | Deferred: deploy the app and configure invites and Cron. |  |  |  |  |
| 14 | Deferred: import the generated workbook into RevControl without repairing headers or dates. |  |  |  |  |
| 15 | If PredictHQ grants written permission, run a separate paired comparison over the same window. |  |  |  |  |

## Demo benchmark

| City | Peak | High or higher |
|---|---|---|
| Eindhoven | [Dutch Design Week](https://ddw.nl/en/faq); [ASML Marathon Eindhoven](https://asmlmarathoneindhoven.nl/) | [GLOW](https://gloweindhoven.nl/en/practical/); PSV–Club Brugge and PSV–Feyenoord from the [PSV match centre](https://www.psv.nl/match-center); [Helldorado](https://www.helldoradofestival.com/); [Revolution Calling](https://www.revolutioncallingfest.com/about) |
| Rotterdam | [WK Turnen](https://www.ahoy.nl/agenda/sport/wk-turnen?d=2026-10-25) | [FERMA Forum](https://ferma.eu/widening-the-lens-registrations-for-ferma-forum-2026-are-now-open/); [Left of the Dial](https://leftofthedial.nl/); Feyenoord–Inter and Feyenoord–FC Porto from the [Feyenoord Champions League schedule](https://www.feyenoord.com/nl/champions-league) |

Add [Wereldhavendagen](https://wereldhavendagen.nl/het-programma-staat-online/) as a Rotterdam Peak benchmark only if it has not started before the run. Do not weaken the frozen benchmark after seeing collection results.

## Publishable events by source

Run this read-only query after the comparison run:

```sql
select
  area.name as hotel,
  source.provider,
  count(distinct source.event_id) as publishable_events
from account_event_areas as link
join collection_areas as area on area.id = link.collection_area_id
join event_sources as source on source.event_id = link.event_id
join hotel_event_scores as score
  on score.event_id = link.event_id
  and score.hotel_id = area.hotel_id
join account_events as decision
  on decision.event_id = link.event_id
  and decision.account_id = link.account_id
join events as event on event.id = link.event_id
where decision.state = 'active'
  and coalesce(score.importance_override, score.suggested_importance)
    in ('High', 'Peak')
  and score.impact_basis <> 'default'
  and source.provider = any(area.enabled_sources)
  and source.source_state = 'active'
  and source.primary_source_confirmed
  and source.public_source_url is not null
  and event.certainty = 'confirmed'
  and event.start_at < current_date + interval '91 days'
  and event.end_at >= current_date
group by area.name, source.provider
order by area.name, source.provider;
```

## Event-by-event provenance

Use this read-only query to inspect which source contributed each displayed event:

```sql
select
  area.name as hotel,
  event.title,
  event.start_at,
  coalesce(score.importance_override, score.suggested_importance) as importance,
  string_agg(distinct source.provider, ', ' order by source.provider) as sources
from account_event_areas as link
join collection_areas as area on area.id = link.collection_area_id
join events as event on event.id = link.event_id
join event_sources as source on source.event_id = event.id
join hotel_event_scores as score
  on score.event_id = event.id
  and score.hotel_id = area.hotel_id
join account_events as decision
  on decision.event_id = event.id
  and decision.account_id = link.account_id
where decision.state = 'active'
  and event.certainty = 'confirmed'
  and coalesce(score.importance_override, score.suggested_importance)
    in ('High', 'Peak')
  and score.impact_basis <> 'default'
  and source.provider = any(area.enabled_sources)
  and source.source_state = 'active'
  and source.primary_source_confirmed
  and source.public_source_url is not null
  and event.start_at < current_date + interval '91 days'
  and event.end_at >= current_date
group by area.name, event.id, score.importance_override, score.suggested_importance
order by area.name, event.start_at, event.title;
```

## Pilot result

- Go or no-go:
- Known-event recall by category:
- False-positive rate:
- Claude searches (expected 12 per hotel):
- Anthropic cost per hotel collection run:
- Sources to keep, change, or remove:
