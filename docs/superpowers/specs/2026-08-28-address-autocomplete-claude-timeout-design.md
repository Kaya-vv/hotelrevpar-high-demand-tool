# Address autocomplete and Claude timeout design

## Goal

Let subscribers select a verified Dutch hotel address while typing, then use that exact BAG record for the hotel coordinates. Give Claude enough time to finish each collection phase and identify which phase timed out.

## Address flow

- Start searching after three characters and wait briefly after the last keystroke.
- Send the query through a server endpoint to the existing PDOK Location API integration.
- Show at most five address results in an accessible listbox.
- Store the selected display address in the visible field and its PDOK identifier in a hidden field.
- Clear the identifier whenever the user changes the selected address text.
- Require a selected PDOK identifier when a hotel is saved.
- Fetch the BAG address by identifier during the save action. Use its normalized address, locality, latitude, and longitude instead of running another text search.

The `hotels` table gains a nullable `pdok_address_id` column. Existing hotels keep working in collection because their stored coordinates remain unchanged. A subscriber must select a suggestion once the next time they edit an existing hotel; later edits retain the saved identifier unless they change the address.

## Failure handling

- An empty search result shows that no address was found and keeps saving disabled by validation.
- A PDOK outage shows that address suggestions are unavailable and leaves the typed text intact.
- A stale or invalid selected identifier fails server-side validation and does not update the hotel.
- The server remains the authority for the normalized address and coordinates.

## Claude timeout

Give both Claude requests a 120-second timeout and keep automatic SDK retries disabled. Wrap the search and verification calls separately so the collection run reports either a search timeout or a verification timeout. This keeps one request retry under the user's control through the existing refresh action and leaves the current collection architecture unchanged.

## Testing

- Verify that PDOK suggestions map identifiers and display names.
- Verify that fetching a selected identifier returns the normalized address and coordinates without a text search.
- Verify that saving rejects typed text without a selected identifier.
- Verify that editing address text clears the current selection.
- Verify that Claude receives the 120-second request option and reports the failing phase.

## Scope

Use React, the current server actions, PDOK, and the existing test stack. Add no UI or address-search dependency. Do not add fuzzy postcode correction, international geocoding, automatic retries, or background Claude jobs.
