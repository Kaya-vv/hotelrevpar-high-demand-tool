# HotelRevPar High Demand Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Eindhoven and Rotterdam pilot that collects demand-driving events, assigns hotel-specific scores, supports account-scoped review, and exports RevControl workbooks.

**Architecture:** One Next.js App Router application runs on Vercel. Supabase provides email authentication, Postgres storage, and Row Level Security. Framework-independent TypeScript modules handle source collection, matching, validation, scoring, and workbook generation.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase Auth and Postgres, `@supabase/ssr`, Vitest, Zod, Anthropic TypeScript SDK, ExcelJS, Vercel Cron, plain CSS.

## Global Constraints

- Start with Eindhoven and Rotterdam and a rolling 12-month window.
- Run collection once per week and expose `Nu verversen` for one account-owned area.
- Treat each subscriber as one operator account with isolated hotels, areas, decisions, scores, runs, and exports.
- Let validated structured events and Claude events with fetched primary-source evidence enter the calendar without manual approval.
- Send conflicts, weak sources, missing required fields, updates, and cancellations to `Te beoordelen`.
- Calculate event impact from 0 to 60, distance from 0 to 25, and stay pressure from 0 to 15.
- Resolve overlap pressure against each neighboring event's score before overlap points. This prevents circular scoring.
- Keep pricing, supplement, minimum-stay, `Add supplement for`, `Split per hotel`, `Note`, and `Source` cells blank in version one.
- Export the approved 13 columns in their supplied order. Split one event into one row per final Importance group when selected hotels have different labels.
- Keep Plug&Pay, hotel-client logins, subscriber submissions, RevControl API access, machine learning, and a job queue outside version one.
- Keep `refs/` untracked. Copy only `refs/logo.webp` into `public/logo.webp` as a product asset.
- Keep all provider keys, `SUPABASE_SERVICE_ROLE_KEY`, and `CRON_SECRET` in server-side environment variables.
- Use current provider contracts: Ticketmaster city and date filters, PredictHQ `within`, start, and predicted-state filters, Rijksoverheid school-holiday open data, OpenHolidaysAPI public holidays, and Anthropic Web Search plus Web Fetch.
- Keep PredictHQ data out of Anthropic requests. Retain provider provenance for source-owned metrics and support provider-data deletion plus score recalculation.
- Use `proxy.ts` for session refresh, `@supabase/ssr` cookie `getAll` and `setAll`, and `Authorization: Bearer ${CRON_SECRET}` for Vercel Cron.

## File Map

- `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `vitest.config.ts`, `vitest.setup.ts`: project and test configuration.
- `.env.example`, `vercel.json`: required secrets and weekly schedule.
- `src/app/`: App Router pages, layouts, route handlers, and global CSS.
- `src/proxy.ts`: Supabase session refresh and login redirect.
- `src/lib/supabase/`: browser, server, and service-role clients plus generated database types.
- `src/lib/auth/`: active-account and platform-admin guards.
- `src/features/accounts/`: manual subscriber provisioning and account disabling.
- `src/features/portfolio/`: hotel and collection-area forms, validation, actions, and queries.
- `src/features/events/`: shared event types, normalization, matching, validation, distance, and scoring.
- `src/features/collection/`: source adapters, persistence, and the shared collection runner.
- `src/features/calendar/`: account-scoped calendar query and split-view components.
- `src/features/review/`: account-scoped accept, edit, exclude, and merge actions.
- `src/features/export/`: RevControl row mapping and ExcelJS workbook generation.
- `supabase/migrations/`: schema, indexes, helper functions, and Row Level Security.
- `supabase/tests/`: database isolation checks.
- `tests/fixtures/`: compact provider responses used by adapter tests.
- `docs/pilot-runbook.md`: coverage comparison, RevControl import, licensing, and release checks.

---

### Task 1: Application Foundation and Branded Shell

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next-env.d.ts`
- Create: `next.config.ts`
- Create: `eslint.config.mjs`
- Create: `vitest.config.ts`
- Create: `vitest.setup.ts`
- Create: `.env.example`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Create: `src/app/globals.css`
- Create: `src/components/app-shell.tsx`
- Create: `src/components/app-shell.test.tsx`
- Create: `public/logo.webp`

**Interfaces:**
- Consumes: approved colors `#064B68`, `#075F82`, `#0A99BD`, and `#FF5428`.
- Produces: `AppShell({ accountName, children, refreshAction })` for all authenticated pages.

- [ ] **Step 1: Write the failing shell test**

```tsx
// src/components/app-shell.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "./app-shell";

describe("AppShell", () => {
  it("renders the approved Dutch navigation and refresh action", () => {
    render(<AppShell accountName="Robert"><p>Inhoud</p></AppShell>);
    expect(screen.getByRole("navigation")).toHaveTextContent("Vraagkalender");
    expect(screen.getByRole("navigation")).toHaveTextContent("Te beoordelen");
    expect(screen.getByRole("button", { name: "Nu verversen" })).toBeEnabled();
    expect(screen.getByText("Robert")).toBeVisible();
  });
});
```

- [ ] **Step 2: Add the pinned project configuration**

```json
// package.json
{
  "name": "hotelrevpar-high-demand-tool",
  "private": true,
  "packageManager": "pnpm@11.24.0",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "0.121.0",
    "@supabase/ssr": "0.12.5",
    "@supabase/supabase-js": "2.112.4",
    "exceljs": "4.4.0",
    "next": "16.3.3",
    "react": "19.2.8",
    "react-dom": "19.2.8",
    "server-only": "0.0.1",
    "zod": "4.4.3"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "7.0.1",
    "@testing-library/react": "16.3.2",
    "@types/node": "26.4.0",
    "@types/react": "19.2.18",
    "@types/react-dom": "19.2.5",
    "@vitejs/plugin-react": "6.1.0",
    "eslint": "9.39.5",
    "eslint-config-next": "16.3.3",
    "jsdom": "30.0.1",
    "supabase": "2.116.0",
    "typescript": "6.0.3",
    "vite": "8.2.2",
    "vitest": "4.1.11"
  }
}
```

Use strict TypeScript, alias `@/*` to `src/*`, jsdom for Vitest, and `@testing-library/jest-dom/vitest` in `vitest.setup.ts`. Copy `refs/logo.webp` to `public/logo.webp` without staging `refs/`.

- [ ] **Step 3: Install and confirm the test fails**

Run: `pnpm install && pnpm test -- src/components/app-shell.test.tsx`

Expected: FAIL because `src/components/app-shell.tsx` does not exist.

- [ ] **Step 4: Implement the shell and brand tokens**

```tsx
// src/components/app-shell.tsx
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

const links = [
  ["/calendar", "Vraagkalender"],
  ["/review", "Te beoordelen"],
  ["/portfolio", "Hotels & regio's"],
  ["/export", "Exporteren"],
  ["/account", "Account"],
] as const;

export function AppShell({ accountName, children, refreshAction }: {
  accountName: string;
  children: ReactNode;
  refreshAction?: () => void | Promise<void>;
}) {
  return <div className="shell">
    <aside className="sidebar">
      <Image src="/logo.webp" alt="HotelRevPar" width={180} height={56} priority />
      <nav aria-label="Hoofdnavigatie">{links.map(([href, label]) =>
        <Link key={href} href={href}>{label}</Link>)}</nav>
    </aside>
    <main className="workspace">
      <header><span>{accountName}</span><form action={refreshAction}><button className="primary">Nu verversen</button></form></header>
      {children}
    </main>
  </div>;
}
```

Define the four approved colors as CSS custom properties. Use CSS Grid for the shell, a visible keyboard focus state, text labels beside status colors, and a single-column layout below 800px.

- [ ] **Step 5: Verify and commit**

Run: `pnpm test -- src/components/app-shell.test.tsx && pnpm lint && pnpm typecheck`

Expected: the shell test passes and both static checks exit 0.

```bash
git add package.json pnpm-lock.yaml tsconfig.json next-env.d.ts next.config.ts eslint.config.mjs vitest.config.ts vitest.setup.ts .env.example src/app src/components public/logo.webp
git commit -m "feat: add branded application shell"
```

### Task 2: Supabase Schema, Isolation, and Authentication

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/migrations/202608270001_initial_schema.sql`
- Create: `supabase/migrations/202608270002_rls.sql`
- Create: `supabase/tests/account_isolation.sql`
- Create: `src/lib/supabase/browser.ts`
- Create: `src/lib/supabase/server.ts`
- Create: `src/lib/supabase/admin.ts`
- Create: `src/lib/supabase/database.types.ts`
- Create: `src/lib/auth/require-account.ts`
- Create: `src/proxy.ts`
- Create: `src/app/login/page.tsx`
- Create: `src/app/login/actions.ts`
- Create: `src/app/(protected)/layout.tsx`
- Create: `src/app/admin/accounts/page.tsx`
- Create: `src/features/accounts/actions.ts`

**Interfaces:**
- Produces: `createBrowserClient()`, `createServerClient()`, `createAdminClient()`, `requireAccount()`, and `requirePlatformAdmin()`.
- Produces: `AccountContext = { userId: string; accountId: string; accountName: string; role: "operator" | "platform_admin" }`.

- [ ] **Step 1: Write the database isolation test**

```sql
-- supabase/tests/account_isolation.sql
begin;
select plan(3);
insert into auth.users(instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'a@example.com', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'b@example.com', '', now(), '{}', '{}', now(), now());
insert into accounts(id, name) values
  ('10000000-0000-0000-0000-000000000001', 'A'),
  ('10000000-0000-0000-0000-000000000002', 'B');
insert into account_members(account_id, user_id, role) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'operator'),
  ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'operator');
insert into hotels(account_id, name, revcontrol_code, latitude, longitude, demand_radius_km)
values ('10000000-0000-0000-0000-000000000001', 'Hotel A', 'A', 51.44, 5.48, 25);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*) from hotels), 0::bigint, 'other account hotel is hidden');
select throws_ok($$insert into hotels(account_id,name,revcontrol_code,latitude,longitude,demand_radius_km)
  values ('10000000-0000-0000-0000-000000000001','X','X',51,5,25)$$, '42501');
select is((select count(*) from accounts), 1::bigint, 'operator sees one account');
select * from finish();
rollback;
```

- [ ] **Step 2: Create the schema and native run lock**

Create enums for `account_role`, `account_event_state`, `event_certainty`, and `run_trigger`. Create the approved tables with UUID primary keys and timestamps. Add these implementation fields required by approved behavior:

```sql
create extension if not exists pgcrypto;
create type account_role as enum ('operator', 'platform_admin');
create type account_event_state as enum ('active', 'needs_review', 'excluded', 'ended');
create type event_certainty as enum ('confirmed', 'provisional');
create type run_trigger as enum ('cron', 'manual');

create table accounts (
  id uuid primary key default gen_random_uuid(), name text not null,
  active boolean not null default true, created_at timestamptz not null default now()
);
create table account_members (
  account_id uuid not null references accounts on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role account_role not null default 'operator', primary key(account_id, user_id), unique(user_id)
);
create table hotels (
  id uuid primary key default gen_random_uuid(), account_id uuid not null references accounts on delete cascade,
  name text not null, revcontrol_code text not null, address text,
  latitude double precision not null, longitude double precision not null,
  demand_radius_km double precision not null check (demand_radius_km > 0),
  holiday_region text check (holiday_region in ('north','middle','south')),
  created_at timestamptz not null default now(), unique(account_id, revcontrol_code)
);
create table collection_areas (
  id uuid primary key default gen_random_uuid(), account_id uuid not null references accounts on delete cascade,
  name text not null, latitude double precision not null, longitude double precision not null,
  radius_km double precision not null check (radius_km > 0),
  enabled_sources text[] not null default array['rijksoverheid','openholidays','ticketmaster','predicthq','claude'],
  created_at timestamptz not null default now(), unique(account_id, name)
);
create table events (
  id uuid primary key default gen_random_uuid(), normalized_identity text not null,
  title text not null, category text not null, venue text, latitude double precision, longitude double precision,
  region_scope text, start_at timestamptz not null, end_at timestamptz not null,
  source_state text not null default 'active', certainty event_certainty not null default 'confirmed',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table event_sources (
  id uuid primary key default gen_random_uuid(), event_id uuid not null references events on delete cascade,
  provider text not null, provider_event_id text not null, source_url text not null,
  extracted_title text not null, extracted_start_at timestamptz not null, extracted_location text,
  evidence_text text, source_state text not null, certainty event_certainty not null default 'confirmed',
  primary_source_confirmed boolean not null default false,
  local_rank integer, attendance integer, venue_capacity integer,
  checked_at timestamptz not null default now(),
  unique(provider, provider_event_id)
);
create table account_events (
  account_id uuid not null references accounts on delete cascade, event_id uuid not null references events on delete cascade,
  state account_event_state not null, review_reason text, operator_note text,
  override_title text, override_start_at timestamptz, override_end_at timestamptz, override_venue text,
  merged_into_event_id uuid references events, decided_at timestamptz, decided_by uuid references auth.users,
  primary key(account_id, event_id)
);
create table account_event_areas (
  account_id uuid not null, event_id uuid not null,
  collection_area_id uuid not null references collection_areas on delete cascade,
  created_at timestamptz not null default now(),
  primary key(account_id, event_id, collection_area_id),
  foreign key(account_id, event_id) references account_events(account_id, event_id) on delete cascade
);
create table hotel_event_scores (
  hotel_id uuid not null references hotels on delete cascade, event_id uuid not null references events on delete cascade,
  distance_km double precision, impact_points integer not null, distance_points integer not null,
  stay_pressure_points integer not null, total integer not null, suggested_importance text not null,
  impact_basis text not null,
  importance_override text, override_note text, primary key(hotel_id, event_id)
);
create table collection_runs (
  id uuid primary key default gen_random_uuid(), account_id uuid not null references accounts on delete cascade,
  collection_area_id uuid not null references collection_areas on delete cascade, trigger run_trigger not null,
  started_at timestamptz not null default now(), finished_at timestamptz,
  source_results jsonb not null default '{}'::jsonb, cost_usage jsonb not null default '{}'::jsonb,
  error_summary text
);
create unique index one_active_run_per_area on collection_runs(collection_area_id) where finished_at is null;
create index events_window_idx on events(start_at, end_at);
create index account_events_state_idx on account_events(account_id, state);
```

- [ ] **Step 3: Add Row Level Security and auth clients**

Create `is_account_member(target uuid)` as a stable `security definer` SQL function with `set search_path = public`. It must require `accounts.active` and `account_members.user_id = auth.uid()`. Enable RLS on every table. Use membership policies for accounts, hotels, areas, account events, account-event area links, scores, and runs. Let a user read an event or source only through an `account_events` row in an account they belong to. Do not grant authenticated clients insert access to canonical events, sources, scores, area links, or runs.

```ts
// src/lib/supabase/server.ts
import { createServerClient as createSsrClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./database.types";

export async function createServerClient() {
  const store = await cookies();
  return createSsrClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: values => { try { values.forEach(({ name, value, options }) => store.set(name, value, options)); } catch {} },
    },
  });
}
```

`src/lib/supabase/admin.ts` must import `server-only` and use the service-role key with `persistSession: false`. `src/proxy.ts` must refresh claims and redirect unauthenticated requests to `/login` while leaving `/login`, `/auth`, and static assets public.

- [ ] **Step 4: Implement login and manual subscriber provisioning**

Use `signInWithPassword` in the login Server Action. `requireAccount()` must call `auth.getClaims()`, load the user's single active membership, and redirect missing memberships to `/login?error=account`.

`createSubscriberAccount(formData)` must require `platform_admin`, invite the email through `auth.admin.inviteUserByEmail`, insert the account and membership, and delete the invited auth user if the database insert fails. `disableAccount(accountId)` sets `accounts.active = false`; it does not delete portfolio data.

- [ ] **Step 5: Reset, test, generate types, and commit**

Run: `pnpm supabase start && pnpm supabase db reset && pnpm supabase test db`

Expected: three pgTAP assertions pass.

Run: `pnpm supabase gen types typescript --local > src/lib/supabase/database.types.ts && pnpm test && pnpm lint && pnpm typecheck`

Expected: all checks exit 0.

```bash
git add supabase src/lib src/proxy.ts src/app/login src/app/\(protected\)/layout.tsx src/app/admin
git commit -m "feat: add isolated accounts and authentication"
```

### Task 3: Hotel and Collection-Area Management

**Files:**
- Create: `src/features/portfolio/schema.ts`
- Create: `src/features/portfolio/actions.ts`
- Create: `src/features/portfolio/queries.ts`
- Create: `src/features/portfolio/schema.test.ts`
- Create: `src/app/(protected)/portfolio/page.tsx`
- Create: `src/features/portfolio/portfolio-form.tsx`

**Interfaces:**
- Produces: `HotelInput`, `CollectionAreaInput`, `saveHotel(formData)`, `saveCollectionArea(formData)`, and `getPortfolio(accountId)`.

- [ ] **Step 1: Write boundary-validation tests**

```ts
import { describe, expect, it } from "vitest";
import { hotelInput, collectionAreaInput } from "./schema";

describe("portfolio input", () => {
  it("accepts an adjustable hotel radius and holiday region", () => {
    expect(hotelInput.parse({ name: "MATCH", revcontrolCode: "MATCH", address: "Eindhoven", latitude: 51.44, longitude: 5.48, demandRadiusKm: 25, holidayRegion: "south" }).demandRadiusKm).toBe(25);
  });
  it("rejects an area without a source", () => {
    expect(() => collectionAreaInput.parse({ name: "Eindhoven", latitude: 51.44, longitude: 5.48, radiusKm: 30, enabledSources: [] })).toThrow();
  });
});
```

- [ ] **Step 2: Run the tests and confirm failure**

Run: `pnpm test -- src/features/portfolio/schema.test.ts`

Expected: FAIL because `schema.ts` does not exist.

- [ ] **Step 3: Implement the schemas and account-scoped actions**

```ts
export const sourceName = z.enum(["rijksoverheid", "openholidays", "ticketmaster", "predicthq", "claude"]);
export const hotelInput = z.object({
  id: z.uuid().optional(), name: z.string().trim().min(1), revcontrolCode: z.string().trim().min(1),
  address: z.string().trim(), latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180), demandRadiusKm: z.coerce.number().positive().max(250),
  holidayRegion: z.enum(["north", "middle", "south"]).nullable(),
});
export const collectionAreaInput = z.object({
  id: z.uuid().optional(), name: z.string().trim().min(1), latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180), radiusKm: z.coerce.number().positive().max(250),
  enabledSources: z.array(sourceName).min(1),
});
```

Each action must get `accountId` from `requireAccount()`, ignore any account ID in form data, and upsert with both `id` and `account_id` filters. Render text, number, and native select or checkbox inputs with labels and field errors.

- [ ] **Step 4: Verify the portfolio page**

Run: `pnpm test -- src/features/portfolio/schema.test.ts && pnpm lint && pnpm typecheck`

Expected: tests and static checks pass. In local Supabase, save one Eindhoven hotel and one Eindhoven area, reload, and confirm both remain visible.

- [ ] **Step 5: Commit**

```bash
git add src/features/portfolio src/app/\(protected\)/portfolio
git commit -m "feat: add hotel and area management"
```

### Task 4: Event Normalization, Matching, Validation, and Scoring

**Files:**
- Create: `src/features/events/types.ts`
- Create: `src/features/events/normalize.ts`
- Create: `src/features/events/match.ts`
- Create: `src/features/events/validate.ts`
- Create: `src/features/events/distance.ts`
- Create: `src/features/events/score.ts`
- Create: `src/features/events/events.test.ts`

**Interfaces:**
- Produces: `EventCandidate`, `ValidationOutcome`, `DemandScore`, `normalizeCandidate`, `classifyMatch`, `validateCandidate`, `distanceKm`, and `scoreHotelEvent`.

- [ ] **Step 1: Define the shared candidate type and failing checks**

```ts
export type SourceName = "rijksoverheid" | "openholidays" | "ticketmaster" | "predicthq" | "claude";
export type EventCandidate = {
  provider: SourceName; providerEventId: string; sourceUrl: string; title: string; category: string;
  venue: string | null; latitude: number | null; longitude: number | null; regionScope: string | null;
  startAt: string; endAt: string; sourceState: "active" | "predicted" | "cancelled" | "postponed";
  certainty: "confirmed" | "provisional";
  localRank: number | null; attendance: number | null; venueCapacity: number | null;
  evidenceText: string | null; primarySourceConfirmed: boolean;
};
```

Write one table-driven Vitest suite that asserts: accents and punctuation normalize; provider IDs match exactly; title/date/venue duplicates merge; similar title/date candidates become `uncertain`; Claude without fetched primary evidence needs review; a complete predicted event stays active with provisional certainty; rank 100 maps to 60 with `local_rank` basis; 15,000 attendees map to 60 with `attendance` basis; radius edge maps to 0; an eligible regional holiday maps to 25 distance points; and totals map to Low, Medium, and High boundaries.

- [ ] **Step 2: Run the suite and confirm failure**

Run: `pnpm test -- src/features/events/events.test.ts`

Expected: FAIL because the domain modules do not exist.

- [ ] **Step 3: Implement deterministic matching and validation**

Normalize with `String.normalize("NFD")`, remove combining marks and punctuation, collapse whitespace, and use the local start date plus normalized venue or region in `normalizedIdentity`. `classifyMatch` returns `exact`, `uncertain`, or `new`: provider ID and normalized identity are exact; same date plus title-token Jaccard score of at least `0.8` is uncertain; the rest are new.

`validateCandidate(candidate, window, conflict)` returns active when required fields exist, the event falls inside the rolling window, no conflict exists, and Claude candidates have `primarySourceConfirmed`. A predicted structured event with usable dates and location remains active with provisional certainty. Map missing source, missing fields, out-of-window, duplicate uncertainty, date conflict, changed date or venue, cancelled, and postponed to stable reason codes.

- [ ] **Step 4: Implement scoring**

```ts
export function importance(total: number) {
  return total >= 70 ? "High" : total >= 40 ? "Medium" : "Low";
}
export function impact(input: { localRank: number | null; attendance: number | null; venueCapacity: number | null; category: string }) {
  if (input.localRank !== null) return { points: Math.round(input.localRank * 0.6), basis: "local_rank" as const };
  const people = input.attendance ?? input.venueCapacity;
  if (people !== null) return { points: people >= 15000 ? 60 : people >= 5000 ? 45 : people >= 2000 ? 35 : people >= 500 ? 20 : 10, basis: input.attendance !== null ? "attendance" as const : "venue_capacity" as const };
  if (input.category === "school_holiday") return { points: 30, basis: "holiday_rule" as const };
  if (input.category === "public_holiday") return { points: 25, basis: "holiday_rule" as const };
  return { points: 20, basis: "default" as const };
}
```

Use the haversine formula for point-event distance. Apply `round(25 * (1 - distance / radius))` inside the radius. Add 6 for multi-day, 4 for an end time at or after 20:00 local time, and 5 when another event has a pre-overlap total of at least 40 and overlaps the current dates. Cap stay pressure at 15 and total at 100.

- [ ] **Step 5: Verify and commit**

Run: `pnpm test -- src/features/events/events.test.ts && pnpm lint && pnpm typecheck`

Expected: all domain assertions pass.

```bash
git add src/features/events
git commit -m "feat: add event matching and hotel scoring"
```

### Task 5: Structured and Claude Source Adapters

**Files:**
- Create: `src/features/collection/types.ts`
- Create: `src/features/collection/http.ts`
- Create: `src/features/collection/sources/rijksoverheid.ts`
- Create: `src/features/collection/sources/openholidays.ts`
- Create: `src/features/collection/sources/ticketmaster.ts`
- Create: `src/features/collection/sources/predicthq.ts`
- Create: `src/features/collection/sources/claude.ts`
- Create: `src/features/collection/sources/sources.test.ts`
- Create: `tests/fixtures/rijksoverheid.json`
- Create: `tests/fixtures/openholidays.json`
- Create: `tests/fixtures/ticketmaster.json`
- Create: `tests/fixtures/predicthq.json`

**Interfaces:**
- Consumes: `EventCandidate`.
- Produces: `collectRijksoverheid(input)`, `collectOpenHolidays(input)`, `collectTicketmaster(input)`, `collectPredictHq(input)`, and `collectClaude(input)` returning `Promise<SourceResult>`.
- `SourceResult = { source: SourceName; candidates: EventCandidate[]; requests: number; usage: Record<string, number> }`.

- [ ] **Step 1: Write adapter contract tests with compact fixtures**

Each fixture must contain one active event, one cancelled or out-of-window event, provider ID, title, start and end, location, coordinates where supported, and source URL. Inject `fetch` into structured adapters and the Anthropic client into the Claude adapter. Assert normalized fields and pagination request counts without network calls.

- [ ] **Step 2: Run tests and confirm failure**

Run: `pnpm test -- src/features/collection/sources/sources.test.ts`

Expected: FAIL because the adapters do not exist.

- [ ] **Step 3: Implement structured adapters with native fetch**

Use `fetchJson(url, schema, fetcher)` with `AbortSignal.timeout(15_000)`, non-2xx rejection, and Zod parsing. Do not retry inside adapters; the collection runner records one source failure without blocking the other sources.

- Rijksoverheid: request `https://opendata.rijksoverheid.nl/v1/infotypes/schoolholidays`, filter `startdate` and `enddate` to the window, and map `region` to `regionScope`.
- OpenHolidaysAPI: request `/PublicHolidays` for `countryIsoCode=NL`, Dutch labels, and the rolling window. Map national holidays to `public_holiday` with country scope. It is the public-holiday source and a school-holiday fallback check, not the primary school calendar.
- Ticketmaster: request `/discovery/v2/events.json` with `apikey`, `city`, `countryCode=NL`, UTC `startDateTime`, UTC `endDateTime`, `size=200`, `page`, and `sort=date,asc`. Stop at the final page or the documented 1,000-item deep-paging limit. Map `dates.status.code` to source state.
- PredictHQ: request `https://api.predicthq.com/v1/events/` with bearer auth, `within={radius}km@{lat},{lon}`, `start.gte`, `start.lte`, `state=active,predicted,deleted`, and attendance categories. Map `local_rank`, `phq_attendance`, predicted end, and event state. Map `predicted` to provisional certainty without sending the event to review for certainty alone.

- [ ] **Step 4: Implement two-stage Claude discovery and verification**

Use `web_search_20260318` with `max_uses: 4`, Dutch location context, and `response_inclusion: "excluded"`. Extract candidate URLs from citation objects. Send those URLs in a second message with `web_fetch_20260318`, citations disabled, `max_uses` equal to the URL count, `max_content_tokens: 12_000`, and `output_config.format` using a JSON schema for event title, date, location, owner type, evidence excerpt, and confirmation flags.

Set `primarySourceConfirmed` only when Web Fetch succeeds and confirms title, date, and location from an organizer, venue, club, university, municipality, or comparable event owner. A search citation without successful fetch produces a candidate that needs review. Read the model from `ANTHROPIC_MODEL`; fail the Claude source with a clear run error when it is missing.

- [ ] **Step 5: Verify and commit**

Run: `pnpm test -- src/features/collection/sources/sources.test.ts && pnpm lint && pnpm typecheck`

Expected: all fixture tests pass without live provider calls.

```bash
git add src/features/collection tests/fixtures .env.example
git commit -m "feat: add event source adapters"
```

### Task 6: Collection Persistence, Failure Isolation, and Refresh Routes

**Files:**
- Create: `src/features/collection/repository.ts`
- Create: `src/features/collection/run.ts`
- Create: `src/features/collection/run.test.ts`
- Create: `src/app/api/areas/[areaId]/refresh/route.ts`
- Create: `src/app/api/cron/collect/route.ts`

**Interfaces:**
- Produces: `runCollection({ accountId, areaId, trigger }, deps): Promise<CollectionRunSummary>`.
- Produces: `CollectionRunSummary = { runId: string; status: "completed" | "partial" | "already_running"; sourceResults: Record<string, unknown> }`.

- [ ] **Step 1: Write orchestration tests with function dependencies**

Test four cases: one failed source leaves successful candidates; a second active-run insert returns `already_running`; repeated provider IDs update instead of duplicating; and a changed date sends the account event to review while preserving the existing active event.

- [ ] **Step 2: Run tests and confirm failure**

Run: `pnpm test -- src/features/collection/run.test.ts`

Expected: FAIL because `run.ts` does not exist.

- [ ] **Step 3: Implement the runner**

Insert `collection_runs` first and treat Postgres code `23505` from `one_active_run_per_area` as `already_running`. Before insert, mark an unfinished run older than one hour as finished with `error_summary = 'stale run recovered'`; this releases a lock left by a timed-out Vercel function.

`runCollection({ accountId, areaId, trigger }, deps)` runs enabled adapters with `Promise.allSettled`. For each candidate: normalize, match provider ID, classify cross-source match, upsert the source with metric and primary-evidence provenance, validate, upsert `account_events`, link it to the discovery area, and score account hotels. Save per-source counts, failures, zero-result success, duplicate counts, review counts, request counts, and Anthropic token and search usage. Finish the run in a `finally` block.

- [ ] **Step 4: Add secured routes**

The manual `POST` route must call `requireAccount()`, query the area with both `id` and `account_id`, then call the shared runner. The Cron `GET` route must reject a missing or incorrect bearer secret with 401, query enabled areas through the service-role client, and run Eindhoven and Rotterdam in sequence. Export `maxDuration = 300` from both routes.

- [ ] **Step 5: Verify and commit**

Run: `pnpm test -- src/features/collection/run.test.ts && pnpm lint && pnpm typecheck`

Expected: all collection tests pass.

```bash
git add src/features/collection src/app/api
git commit -m "feat: add resilient event collection"
```

### Task 7: Split Calendar and Exception Review

**Files:**
- Create: `src/features/calendar/query.ts`
- Create: `src/features/calendar/calendar-view.tsx`
- Create: `src/features/calendar/calendar-view.test.tsx`
- Create: `src/app/(protected)/calendar/page.tsx`
- Create: `src/features/review/actions.ts`
- Create: `src/features/review/review-list.tsx`
- Create: `src/features/review/review-list.test.tsx`
- Create: `src/app/(protected)/review/page.tsx`

**Interfaces:**
- Produces: `CalendarEvent` with account overrides, per-hotel scores, certainty, impact basis, evidence confidence, source links, and latest source status.
- Produces: `acceptEvent`, `editEvent`, `excludeEvent`, `mergeEvent`, and `overrideImportance` Server Actions.

- [ ] **Step 1: Write component tests**

Render one multi-day event, one provisional event, and one review event. Assert month cells, event title, textual Importance, impact basis, `Voorlopig` label, score components, source link, review reason, and Accept/Edit/Exclude/Merge controls. Assert a portfolio event shows separate hotel scores.

- [ ] **Step 2: Run tests and confirm failure**

Run: `pnpm test -- src/features/calendar src/features/review`

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement the account-scoped calendar query and split view**

Use URL parameters `month`, `hotel`, `area`, `category`, `maxDistance`, and `importance`. Default `month` to the current Amsterdam month. Query only `account_events.state = active`, apply account overrides, and join scores for account-owned hotels. Render a CSS Grid month on the left and the filtered event list on the right. Use text plus color for Low, Medium, High, provisional, and review state. Show the last collection time and distinguish success with zero results from failed, disabled, unlicensed, or stale sources.

- [ ] **Step 4: Implement account-scoped review actions**

Accept sets state active. Edit writes only `account_events.override_*`. Exclude sets state excluded. Merge sets the duplicate account event to excluded and records `merged_into_event_id`; it does not modify canonical events or another account. Importance override updates a score only after verifying the hotel belongs to the active account. Each action stores `decided_by`, `decided_at`, and an operator note, then revalidates calendar and review paths.

- [ ] **Step 5: Verify and commit**

Run: `pnpm test -- src/features/calendar src/features/review && pnpm lint && pnpm typecheck`

Expected: component and static checks pass.

```bash
git add src/features/calendar src/features/review src/app/\(protected\)/calendar src/app/\(protected\)/review
git commit -m "feat: add demand calendar and review workflow"
```

### Task 8: RevControl Workbook Export

**Files:**
- Create: `src/features/export/types.ts`
- Create: `src/features/export/map-rows.ts`
- Create: `src/features/export/build-workbook.ts`
- Create: `src/features/export/export.test.ts`
- Create: `src/app/(protected)/export/page.tsx`
- Create: `src/app/api/export/route.ts`

**Interfaces:**
- Produces: `mapRevControlRows(events, selectedHotelIds): RevControlRow[]`.
- Produces: `buildRevControlWorkbook(rows): Promise<Buffer>`.

- [ ] **Step 1: Write workbook contract tests**

Use two hotels where one event is High for one hotel and Medium for the other. Read the generated buffer back with ExcelJS and assert: sheet `Blad1`; exact 13 headers; two rows grouped by Importance; typed Date values in columns C and D with `dd-mm-yyyy`; `Yes` in Show; comma-separated RevControl codes; and blank cells for all approved blank fields, including `Add supplement for`.

- [ ] **Step 2: Run tests and confirm failure**

Run: `pnpm test -- src/features/export/export.test.ts`

Expected: FAIL because export modules do not exist.

- [ ] **Step 3: Implement row mapping**

Group active account events by event ID and final Importance. Sort rows by start date, event title, then Importance. Use override dates and titles when present. Reject an export request containing a hotel outside the active account before querying events.

```ts
export const REVCONTROL_HEADERS = [
  "Show", "Event", "Start date", "End date", "Importance", "Supplement Percentage",
  "Supplement", "MLS", "Add supplement for", "Hotel(s)", "Split per hotel", "Note", "Source",
] as const;
```

- [ ] **Step 4: Implement workbook generation and download**

`buildRevControlWorkbook(rows)` creates one worksheet named `Blad1` and one Excel table. Style row 1 with fill `FFC7DAF1`, Calibri 12, bold italic text. Store dates as JavaScript `Date` values and apply `dd-mm-yyyy`. Match the reference column widths. Return the buffer from a Node runtime route with the XLSX content type and `attachment; filename="events-YYYY-MM.xlsx"`.

- [ ] **Step 5: Verify and commit**

Run: `pnpm test -- src/features/export/export.test.ts && pnpm lint && pnpm typecheck`

Expected: workbook contract and static checks pass.

```bash
git add src/features/export src/app/\(protected\)/export src/app/api/export
git commit -m "feat: add RevControl workbook export"
```

### Task 9: Weekly Schedule, Source Health, and Pilot Release Gates

**Files:**
- Create: `vercel.json`
- Create: `src/features/accounts/source-health.ts`
- Create: `src/app/admin/source-health/page.tsx`
- Create: `src/app/admin/source-health/page.test.tsx`
- Create: `docs/pilot-runbook.md`
- Modify: `.env.example`
- Modify: `src/components/app-shell.tsx`

**Interfaces:**
- Consumes: `collection_runs.source_results` and `cost_usage`.
- Produces: platform-admin source-health screen and a repeatable pilot acceptance checklist.

- [ ] **Step 1: Write source-health and Cron authorization tests**

Assert that the source-health page shows last success, current error, found, unique, duplicate, review, request, and Anthropic usage values. Call the Cron route with no bearer header and assert 401; call it with a matching injected secret and assert it invokes the shared runner.

- [ ] **Step 2: Run tests and confirm failure**

Run: `pnpm test -- src/app/admin/source-health src/app/api/cron`

Expected: FAIL because the health query and schedule are incomplete.

- [ ] **Step 3: Add the weekly schedule and health screen**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [{ "path": "/api/cron/collect", "schedule": "0 5 * * 1" }]
}
```

Show one row per collection run and expandable per-source results. Platform administrators may inspect health across accounts through a server-only service-role query after `requirePlatformAdmin()`; they do not receive portfolio impersonation.

- [ ] **Step 4: Write the pilot runbook**

Include these exact gates with evidence fields for date, operator, result, and link or file:

1. Configure Supabase, Vercel, Ticketmaster, PredictHQ, Anthropic, and Cron secrets.
2. Create Robert's platform account and operator portfolio.
3. Add Eindhoven and Rotterdam areas and known hotels.
4. Confirm the PredictHQ plan or trial extension exposes the full 12-month window.
5. Run the 12-month comparison and record known-event recall by category, first-discovery lead time, unique events, duplicates, false positives, conflicts, missed known events, source failures, and review count.
6. Confirm one verified Claude event enters the calendar and one conflicting event enters review.
7. Confirm one PredictHQ predicted event appears as `Voorlopig` without entering the exception queue.
8. Confirm one event receives different hotel scores based on distance and shows its impact basis.
9. Exclude an event and confirm it leaves that account's export.
10. Import the generated workbook into RevControl without repairing headers or dates.
11. Repeat collection and confirm provider IDs do not create duplicates.
12. Obtain written PredictHQ confirmation for storage, combination, subscriber display, XLSX export, attribution, approved application use, and termination handling. Check Ticketmaster attribution terms.
13. Run a historical KOOP permit sample for Eindhoven and Rotterdam and record useful-event precision and publication lead time before deciding on an adapter.
14. Confirm RLS isolation tests, full tests, lint, typecheck, and production build pass.
15. Compare the app colors against the live HotelRevPar website CSS and record any token correction.

- [ ] **Step 5: Run the complete verification suite**

Run: `pnpm supabase db reset && pnpm supabase test db && pnpm test && pnpm lint && pnpm typecheck && pnpm build`

Expected: database tests, unit and component tests, lint, typecheck, and production build pass.

Perform the simplification review before release: confirm no queue, billing integration, ML model, RevControl API client, subscriber event form, client login, UI kit, calendar dependency, or fuzzy-match dependency entered the codebase. Record any added safeguard beside the failure mode or spec requirement that requires it.

- [ ] **Step 6: Commit the operational finish**

```bash
git add vercel.json .env.example src/features/accounts src/app/admin src/components/app-shell.tsx docs/pilot-runbook.md
git commit -m "chore: add pilot operations and release gates"
```

## Execution Order and Checkpoints

Review after Tasks 2, 6, and 8. Those checkpoints prove account isolation, source coverage, and RevControl compatibility before UI polish or a paid launch. Do not connect a production Vercel or Supabase project until local checks pass and the user authorizes deployment.

## Current Documentation Used

- Next.js 16 App Router, route handlers, server-only modules, and Vitest: <https://nextjs.org/docs>
- Supabase SSR authentication and Row Level Security: <https://supabase.com/docs>
- Vercel Cron authorization and function duration: <https://vercel.com/docs/cron-jobs>
- Ticketmaster Discovery API v2: <https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/>
- PredictHQ Events API: <https://docs.predicthq.com/api/events/search-events>
- Rijksoverheid school-holiday open data: <https://www.rijksoverheid.nl/opendata/schoolvakanties>
- OpenHolidaysAPI: <https://www.openholidaysapi.org/en/>
- Anthropic Web Search, Web Fetch, and structured outputs: <https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool>
- ExcelJS workbook and table API: <https://github.com/exceljs/exceljs>
