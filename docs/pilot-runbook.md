# HotelRevPar High Demand Tool Pilot Runbook

Record the evidence for each gate before inviting a paying subscriber.

| # | Release gate | Date | Operator | Result | Link or file |
|---:|---|---|---|---|---|
| 1 | Configure Supabase, Vercel, Ticketmaster, PredictHQ, Anthropic, and Cron secrets. |  |  |  |  |
| 2 | Create Robert's platform account and operator portfolio. |  |  |  |  |
| 3 | Add Eindhoven and Rotterdam areas and known hotels. |  |  |  |  |
| 4 | Confirm the PredictHQ plan or trial extension exposes the full 12-month window. |  |  |  |  |
| 5 | Run the 12-month comparison and record known-event recall by category, first-discovery lead time, unique events, duplicates, false positives, conflicts, missed known events, source failures, and review count. |  |  |  |  |
| 6 | Confirm one verified Claude event enters the calendar and one conflicting event enters review. |  |  |  |  |
| 7 | Confirm one PredictHQ predicted event appears as `Voorlopig` without entering the exception queue. |  |  |  |  |
| 8 | Confirm one event receives different hotel scores based on distance and shows its impact basis. |  |  |  |  |
| 9 | Exclude an event and confirm it leaves that account's export. |  |  |  |  |
| 10 | Import the generated workbook into RevControl without repairing headers or dates. |  |  |  |  |
| 11 | Repeat collection and confirm provider IDs do not create duplicates. |  |  |  |  |
| 12 | Obtain written PredictHQ confirmation for storage, combination, subscriber display, XLSX export, attribution, approved application use, and termination handling. Check Ticketmaster attribution terms. |  |  |  |  |
| 13 | Run a historical KOOP permit sample for Eindhoven and Rotterdam and record useful-event precision and publication lead time before deciding on an adapter. |  |  |  |  |
| 14 | Confirm RLS isolation tests, full tests, lint, typecheck, and production build pass. |  |  |  |  |
| 15 | Compare the app colors against the live HotelRevPar website CSS and record any token correction. |  |  |  |  |

## Pilot result

- Go or no-go:
- Known-event recall by category:
- False-positive rate:
- Median first-discovery lead time:
- Monthly provider and Anthropic cost:
- Sources to keep, change, or remove:
