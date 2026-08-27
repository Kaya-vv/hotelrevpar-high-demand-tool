# Address-based collection and refresh feedback implementation plan

**Goal:** Replace subscriber-managed coordinates and regions with address-based hotel setup, bound Claude discovery, and show live refresh feedback.

**Architecture:** PDOK geocodes each saved hotel. Hotel source settings and locality live on the hotel row; a PostgreSQL trigger synchronizes one hidden `collection_areas` row per hotel. The existing collection runner and evidence pipeline continue to use collection areas internally. Client components supply pending state and route polling without adding a job system.

**Tech stack:** Next.js 16, React 19, Supabase/PostgreSQL, Anthropic TypeScript SDK, Zod, Vitest.

### Task 1: Lock the requirements with failing tests

**Files:**
- Modify: `src/features/collection/sources/sources.test.ts`
- Modify: `src/features/portfolio/schema.test.ts`
- Modify: `src/features/portfolio/portfolio-form.test.tsx`
- Modify: `src/features/calendar/calendar-view.test.tsx`
- Create: `src/features/portfolio/geocode.test.ts`

1. Assert that Claude uses direct search inclusion, two search uses, eight fetched URLs, and per-request timeouts.
2. Assert that hotel input requires an address and sources but no coordinates.
3. Assert that the hotel form hides coordinate and region management and exposes advanced source settings.
4. Assert that an active collection announces automatic refresh.
5. Assert that the PDOK adapter maps a BAG address to normalized address, locality, latitude, and longitude and rejects an empty result.
6. Run the focused tests and confirm they fail for the intended missing behavior.

### Task 2: Implement address-based hotel setup

**Files:**
- Create: `src/features/portfolio/geocode.ts`
- Modify: `src/features/portfolio/schema.ts`
- Modify: `src/features/portfolio/actions.ts`
- Modify: `src/features/portfolio/queries.ts`
- Modify: `src/features/portfolio/portfolio-form.tsx`
- Modify: `src/app/(protected)/portfolio/page.tsx`
- Modify: `src/components/app-shell.tsx`
- Create: `supabase/migrations/202608280005_hotel_collection_areas.sql`
- Regenerate: `src/lib/supabase/database.types.ts`

1. Parse PDOK search and BAG item responses with Zod.
2. Geocode before saving and return an address field error on failure.
3. Store locality and enabled sources on hotels.
4. Add a database trigger that inserts or updates the hotel-linked internal collection area.
5. Backfill linked areas without deleting old areas.
6. Remove the region editor and coordinate fields from subscriber UI.
7. Run the focused portfolio tests.

### Task 3: Bound Claude discovery and use hotel locations

**Files:**
- Modify: `src/features/collection/sources/claude.ts`
- Modify: `src/features/collection/run.ts`
- Modify: `src/features/collection/repository.ts`
- Modify: `src/features/collection/actions.ts`
- Modify: `src/app/api/cron/collect/route.ts`
- Modify: `src/features/calendar/query.ts`

1. Configure direct web search with full inclusion, two uses, an eight-URL cap, and a 60-second request timeout.
2. Use the internal area's locality for city-based collectors.
3. Limit manual and scheduled collection to hotel-linked areas.
4. Hide the internal area filter from the calendar.
5. Run collection source and runner tests.

### Task 4: Add refresh feedback

**Files:**
- Create: `src/components/refresh-button.tsx`
- Create: `src/components/refresh-button.test.tsx`
- Modify: `src/components/app-shell.tsx`
- Modify: `src/features/calendar/calendar-view.tsx`
- Modify: `src/features/calendar/query.ts`

1. Show pending text and elapsed seconds through `useFormStatus`.
2. Include the run start time in calendar data.
3. Refresh the route every three seconds while a run is active and announce that behavior.
4. Run the focused component tests.

### Task 5: Apply and verify

1. Apply the Supabase migration to the running local project and regenerate types.
2. Run all tests, typecheck, lint, and production build.
3. Test hotel save and refresh behavior in the browser.
4. Run a simplification pass and inspect the final diff.
5. Commit and push only the intended files to `main`.
