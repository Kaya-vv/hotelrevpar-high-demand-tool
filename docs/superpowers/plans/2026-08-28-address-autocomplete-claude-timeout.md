# Address Autocomplete and Claude Timeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require a verified PDOK address selection for hotels and give each Claude phase 120 seconds with phase-specific timeout errors.

**Architecture:** Extend the current PDOK module with suggestion search and identifier-based lookup. A protected Next route supplies suggestions to a small React combobox, while the save action resolves the selected identifier and persists it. Claude keeps its two-request flow but wraps each request with a named timeout error.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase, Zod, Vitest, PDOK Location API, Anthropic SDK

## Global Constraints

- Add no UI or address-search dependency.
- Keep automatic Anthropic SDK retries disabled.
- Preserve existing hotel coordinates until an existing hotel is edited.
- Require a selected PDOK identifier for every new or edited hotel save.

---

### Task 1: PDOK suggestion and exact-address functions

**Files:**
- Modify: `src/features/portfolio/geocode.ts`
- Modify: `src/features/portfolio/geocode.test.ts`
- Create: `src/app/api/addresses/route.ts`
- Create: `src/app/api/addresses/route.test.ts`

**Interfaces:**
- Produces: `searchAddresses(query, fetcher?) => Promise<Array<{ id: string; label: string }>>`
- Produces: `getAddressById(id, fetcher?) => Promise<{ address; locality; latitude; longitude }>`
- Produces: authenticated `GET /api/addresses?q=...` returning `{ suggestions }`

- [ ] **Step 1: Write failing tests**

Test that search maps at most five PDOK features with `id` and `properties.display_name`, exact lookup maps BAG properties, short queries return no results, and the route rejects unauthenticated calls.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `pnpm test -- src/features/portfolio/geocode.test.ts src/app/api/addresses/route.test.ts`

Expected: FAIL because the new functions and route do not exist.

- [ ] **Step 3: Implement the minimal PDOK functions and route**

Use the existing response validation and 10-second timeout. Search with `adres[version]=1`, `limit=5`, and `f=json`. Resolve selected addresses through `/kadaster/bag/ogc/v2/collections/adres/items/{id}`. Require the current account before returning suggestions.

- [ ] **Step 4: Run the focused tests**

Run: `pnpm test -- src/features/portfolio/geocode.test.ts src/app/api/addresses/route.test.ts`

Expected: PASS.

### Task 2: Persist selection and add the accessible combobox

**Files:**
- Create: `supabase/migrations/202608280006_hotel_pdok_address.sql`
- Modify: `src/lib/supabase/database.types.ts`
- Modify: `src/features/portfolio/schema.ts`
- Modify: `src/features/portfolio/schema.test.ts`
- Modify: `src/features/portfolio/actions.ts`
- Modify: `src/features/portfolio/queries.ts`
- Create: `src/features/portfolio/address-combobox.tsx`
- Create: `src/features/portfolio/address-combobox.test.tsx`
- Modify: `src/features/portfolio/portfolio-form.tsx`
- Modify: `src/features/portfolio/portfolio-form.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `getAddressById(id)` from Task 1
- Produces: nullable `hotels.pdok_address_id`
- Produces: `AddressCombobox({ defaultAddress, defaultAddressId, error })`

- [ ] **Step 1: Write failing validation and component tests**

Test that `hotelInput` rejects a missing `addressId`, accepts a non-empty PDOK identifier, displays suggestions returned after typing, copies the selected label and identifier into form fields, and clears the identifier after the text changes.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `pnpm test -- src/features/portfolio/schema.test.ts src/features/portfolio/address-combobox.test.tsx src/features/portfolio/portfolio-form.test.tsx`

Expected: FAIL because `addressId` and `AddressCombobox` do not exist.

- [ ] **Step 3: Add persistence and server-side validation**

Add `pdok_address_id text` to `hotels`, update generated database types by hand to match the migration, parse `addressId`, call `getAddressById(addressId)`, and save both the normalized address and identifier. Existing rows remain nullable; an edit requires a new selection because the parsed form requires an identifier.

- [ ] **Step 4: Implement the minimal combobox**

Use a controlled input, a hidden `addressId` input, a 300 ms timer, `fetch('/api/addresses?q=...')`, and native React state. Render a labelled listbox with buttons for results, a loading message, no-results copy, and a service-error message. Clear the selected identifier on text edits and support Escape plus arrow-key selection.

- [ ] **Step 5: Run the focused tests**

Run: `pnpm test -- src/features/portfolio/schema.test.ts src/features/portfolio/address-combobox.test.tsx src/features/portfolio/portfolio-form.test.tsx`

Expected: PASS.

- [ ] **Step 6: Apply the local migration**

Run: `pnpm exec supabase migration up --local`

Expected: migration `202608280006_hotel_pdok_address.sql` applies successfully.

### Task 3: Claude timeout diagnostics

**Files:**
- Modify: `src/features/collection/sources/claude.ts`
- Modify: `src/features/collection/sources/sources.test.ts`

**Interfaces:**
- Produces: `{ timeout: 120_000, maxRetries: 0 }` for both requests
- Produces: `Claude search timed out.` and `Claude verification timed out.` errors

- [ ] **Step 1: Update tests first**

Expect both requests to receive the 120-second timeout and add separate rejected-request cases for search and verification.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm test -- src/features/collection/sources/sources.test.ts`

Expected: FAIL because the implementation still uses 60 seconds and generic SDK errors.

- [ ] **Step 3: Implement phase-specific request wrappers**

Keep `maxRetries: 0`, set `timeout: 120_000`, and catch only Anthropic timeout errors around each `messages.create` call. Throw the named phase error and rethrow other errors unchanged.

- [ ] **Step 4: Run focused and full verification**

Run: `pnpm test -- src/features/collection/sources/sources.test.ts`

Expected: PASS.

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build`

Expected: all commands pass.

- [ ] **Step 5: Review and commit**

Check `git diff --check`, confirm `.env.example`, `next-env.d.ts`, and `supabase/snippets/` were not staged, then commit the cohesive implementation.
