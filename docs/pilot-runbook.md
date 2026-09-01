# HotelRevPar High Demand Tool Pilot Runbook

Record the evidence for each gate before inviting a paying subscriber.

| # | Release gate | Date | Operator | Result | Link or file |
|---:|---|---|---|---|---|
| 1 | Configure Supabase, Vercel, Ticketmaster, Anthropic, and Cron secrets. Set the Supabase invite email URL to `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=invite` and allow the production `/auth/confirm` redirect URL. |  |  |  |  |
| 2 | Create Robert's platform account and operator portfolio. |  |  |  |  |
| 3 | Add Eindhoven and Rotterdam areas and known hotels. |  |  |  |  |
| 4 | Disable PredictHQ on the pilot hotels until written permission covers the intended use. |  |  |  |  |
| 5 | Freeze a known-event benchmark for each pilot hotel from Robert's existing calendars, exports, and known high-demand dates. |  |  |  |  |
| 6 | Run four collection cycles over rolling 90-day windows and record source failures and Claude cost. |  |  |  |  |
| 7 | Confirm displayed and exported events are Medium or higher and use a non-default impact basis. |  |  |  |  |
| 8 | Confirm Low, default-basis, unsupported, and conflicted events stay out of subscriber output. |  |  |  |  |
| 9 | Confirm one official cancellation leaves the subscriber calendar without a manager review task. |  |  |  |  |
| 10 | Import the generated workbook into RevControl without repairing headers or dates. |  |  |  |  |
| 11 | If PredictHQ grants permission, enable it with the existing source control and run one paired comparison over the same 90-day window. |  |  |  |  |
| 12 | Record unique Medium-or-higher events by source, benchmark misses, false positives, failures, and cost per accepted event. |  |  |  |  |
| 13 | Confirm RLS isolation tests, full tests, lint, typecheck, and production build pass. |  |  |  |  |
| 14 | Compare the app colors against the live HotelRevPar website CSS and record any token correction. |  |  |  |  |

## Publishable events by source

Run this read-only query after each comparison cycle:

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
    in ('Medium', 'High', 'Peak')
  and score.impact_basis <> 'default'
  and event.start_at < current_date + interval '91 days'
  and event.end_at >= current_date
group by area.name, source.provider
order by area.name, source.provider;
```

## Pilot result

- Go or no-go:
- Known-event recall by category:
- False-positive rate:
- Median first-discovery lead time:
- Monthly provider and Anthropic cost:
- Sources to keep, change, or remove:
