# Address-based collection and refresh feedback

## Goal

Hotel owners configure a hotel with its normal address. The app derives its coordinates and collection location, keeps collection areas internal, and gives clear feedback while a manual refresh runs. Claude web search must return usable source URLs within a bounded time and token budget.

## Hotel setup

- Require hotel name, RevControl code, and a full Dutch address.
- Geocode the address through the free PDOK Location API when the hotel is saved.
- Store the normalized address, coordinates, and locality on the hotel.
- Keep the demand radius and holiday region editable.
- Move source selection into an advanced section on the hotel form.
- Create and maintain one internal collection area per hotel with a database trigger. Subscribers do not manage collection areas.
- Keep old unlinked collection areas for history, but manual and scheduled collection use hotel-linked areas only.

## Refresh feedback

- Disable the refresh button while the server action is pending and show elapsed time.
- Keep the current calendar visible during collection.
- Poll the calendar route while the latest run is unfinished so completion and source results appear without a manual reload.
- Do not add per-source progress storage. The bounded Claude calls remove the observed multi-minute stall, and source results appear when the run finishes.

## Claude collection

- Force direct web-search tool calls so result blocks remain available to the application.
- Include search results in the response, allow at most two searches, and verify at most eight URLs.
- Give each Anthropic request a 60-second timeout with no automatic retry.
- Preserve the evidence gate: only verified owner pages can mark `primarySourceConfirmed`.

## Failure handling

- Reject an address when PDOK finds no address or returns malformed data.
- Let the collection runner record Claude timeout or API errors as a failed source while other sources finish.
- Use a database trigger to keep hotel and internal-area settings synchronized in the same transaction.

## Deferred work

- Shared regional collection areas across nearby hotels.
- Address autocomplete and a map preview.
- Persisted per-source progress during a running collection.

