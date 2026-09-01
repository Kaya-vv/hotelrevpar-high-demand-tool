# Automated 90-Day Event Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an automated rolling 90-day demand calendar that uses controlled Claude discovery, hides weak demand, and keeps PredictHQ as an admin-controlled enrichment source.

**Architecture:** Keep the existing collector and per-hotel source controls. Replace the broad Claude query with three bounded searches over code-owned official domains, refresh a bounded set of stored Claude source pages, and filter subscriber calendar and export output through one shared publishability rule. Store Low and weak events for provenance, but keep them out of subscriber output.

**Tech Stack:** Next.js 16.3.3, TypeScript 6.0.3, Anthropic SDK 0.121.0, Supabase Postgres, Zod 4.4.3, Vitest 4.1.11

## Global Constraints

- Search 90 days ahead and run collection once a week.
- Show Medium, High, and Peak events with a non-default demand basis.
- Do not add a version-mode framework, dependency, worker service, or subscriber review flow.
- Keep PredictHQ behind the existing platform-admin source checkbox.
- Do not use PredictHQ data outside its permitted trial or written commercial rights.
- Preserve account isolation, source provenance, partial-run handling, and RevControl export format.
- Use `pnpm.cmd` commands on Windows.
- Run `pnpm.cmd test`, `pnpm.cmd typecheck`, `pnpm.cmd lint`, `pnpm.cmd build`, and `git diff --check` before completion.

---

## File Map

- Create `src/features/collection/sources/trusted-event-domains.ts`: code-owned Eindhoven and Rotterdam domain registry.
- Modify `src/features/collection/sources/claude.ts`: focused searches, bounded fetches, stored-page refresh input, and event status extraction.
- Modify `src/features/collection/sources/sources.test.ts`: Claude source contract checks.
- Modify `src/features/collection/repository.ts`: 90-day window, seven-day cadence, and bounded stored Claude URLs.
- Modify `src/features/collection/run.ts`: pass stored Claude URLs and update cadence text.
- Modify `src/features/collection/run.test.ts`: window, cadence, and stored-URL selection checks.
- Modify `src/features/events/importance.ts`: shared subscriber publishability rule.
- Modify `src/features/events/events.test.ts`: demand-output rule checks.
- Modify `src/features/calendar/query.ts`: hide Low and default-basis scores.
- Modify `src/features/export/types.ts`: carry impact basis to row mapping.
- Modify `src/features/export/query.ts`: load impact basis.
- Modify `src/features/export/map-rows.ts`: enforce the shared publishability rule.
- Modify `src/features/export/export.test.ts`: prove weak events cannot enter RevControl output.
- Modify `docs/pilot-runbook.md`: 90-day rollout, PredictHQ opt-in, and aggregate comparison query.

---

### Task 1: Change the collection window and Claude cadence

**Files:**
- Modify: `src/features/collection/repository.ts:35-40,191-205`
- Modify: `src/features/collection/run.ts:283-295`
- Test: `src/features/collection/run.test.ts:1-49,308-325`

**Interfaces:**
- Produces: `collectionWindow(now?: Date): CollectionWindow`
- Produces: `claudeDiscoveryDue(lastFinishedAt: string | null, now?: Date): boolean`
- Consumes: existing `CollectionWindow` and `CollectionRepository.shouldRunClaudeDiscovery`

- [ ] **Step 1: Write failing window and cadence tests**

Add the import and tests to `src/features/collection/run.test.ts`:

```ts
import {
  claudeDiscoveryDue,
  collectionWindow,
} from "./repository";

it("uses a rolling 90-day collection window", () => {
  expect(collectionWindow(new Date("2026-09-01T12:00:00Z"))).toEqual({
    start: "2026-09-01",
    end: "2026-11-30",
  });
});

it("runs Claude discovery again after seven days", () => {
  const now = new Date("2026-09-01T12:00:00Z");
  expect(claudeDiscoveryDue(null, now)).toBe(true);
  expect(claudeDiscoveryDue("2026-08-26T12:00:01Z", now)).toBe(false);
  expect(claudeDiscoveryDue("2026-08-25T12:00:00Z", now)).toBe(true);
});
```

Change the existing skipped-discovery expectation to:

```ts
expect(result.sourceResults.claude).toEqual({
  state: "skipped",
  reason: "Claude discovery runs at most once every 7 days.",
});
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```powershell
pnpm.cmd vitest run src/features/collection/run.test.ts
```

Expected: FAIL because `collectionWindow` and `claudeDiscoveryDue` do not exist and the skip text still says 28 days.

- [ ] **Step 3: Implement the 90-day window and seven-day cadence**

Replace `window()` in `src/features/collection/repository.ts` with:

```ts
export function collectionWindow(now = new Date()) {
  const start = new Date(now);
  const end = new Date(now);
  end.setUTCDate(end.getUTCDate() + 90);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

export function claudeDiscoveryDue(
  lastFinishedAt: string | null,
  now = new Date()
) {
  return (
    !lastFinishedAt ||
    now.getTime() - new Date(lastFinishedAt).getTime() >=
      7 * 24 * 60 * 60 * 1000
  );
}
```

Use `const window = collectionWindow();` inside `loadContext`, return that value, and replace the final cadence calculation with:

```ts
return claudeDiscoveryDue(lastDiscovery?.finished_at ?? null);
```

Change the Claude skip reason in `src/features/collection/run.ts` to:

```ts
reason: "Claude discovery runs at most once every 7 days.",
```

- [ ] **Step 4: Run the focused test and confirm success**

Run:

```powershell
pnpm.cmd vitest run src/features/collection/run.test.ts
```

Expected: PASS with all tests in `run.test.ts` passing.

- [ ] **Step 5: Commit the task**

```powershell
git add -- src/features/collection/repository.ts src/features/collection/run.ts src/features/collection/run.test.ts
git commit -m "feat: use a rolling 90-day collection window"
```

---

### Task 2: Replace broad Claude discovery with bounded official-domain searches

**Files:**
- Create: `src/features/collection/sources/trusted-event-domains.ts`
- Modify: `src/features/collection/sources/claude.ts:231-343`
- Test: `src/features/collection/sources/sources.test.ts:141-245`

**Interfaces:**
- Produces: `trustedEventDomains(location: string): string[]`
- Extends: `collectClaude(input)` with optional `knownUrls?: string[]`
- Preserves: `collectClaude(input): Promise<SourceResult>`

- [ ] **Step 1: Write failing focused-search tests**

Replace the broad Claude discovery fixture with a four-call sequence: three search responses and one fetch response. Use this test body in `src/features/collection/sources/sources.test.ts`:

```ts
it("searches trusted Eindhoven domains in three bounded groups", async () => {
  const searchResponse = (url: string) => ({
    content: [
      {
        type: "web_search_tool_result",
        content: [{ type: "web_search_result", url }],
      },
    ],
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      server_tool_use: { web_search_requests: 1 },
    },
  });
  const create = vi
    .fn()
    .mockResolvedValueOnce(
      searchResponse("https://www.thisiseindhoven.com/en/events/ddw")
    )
    .mockResolvedValueOnce(
      searchResponse("https://www.psv.nl/media/artikel/wedstrijdprogramma")
    )
    .mockResolvedValueOnce(
      searchResponse("https://www.tue.nl/en/events/open-day")
    )
    .mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            events: [
              {
                sourceUrl: "https://www.thisiseindhoven.com/en/events/ddw",
                title: "Dutch Design Week",
                category: "festival",
                venue: "Strijp-S",
                latitude: 51.448,
                longitude: 5.458,
                regionScope: null,
                startAt: "2026-10-17T10:00:00+02:00",
                endAt: "2026-10-25T18:00:00+01:00",
                status: "active",
                ownerType: "organizer",
                evidenceText: "Meerdaags evenement met landelijke bezoekers.",
                impactPoints: 45,
                titleConfirmed: true,
                dateConfirmed: true,
                locationConfirmed: true,
              },
            ],
          }),
        },
      ],
      usage: {
        input_tokens: 300,
        output_tokens: 80,
        server_tool_use: { web_fetch_requests: 3 },
      },
    });

  const result = await collectClaude({
    start: "2026-09-01",
    end: "2026-11-30",
    location: "Eindhoven",
    radiusKm: 25,
    model: "claude-test",
    client: { messages: { create } } as unknown as Anthropic,
    geocode: vi.fn(),
  });

  expect(create).toHaveBeenCalledTimes(4);
  create.mock.calls.slice(0, 3).forEach(([request]) => {
    expect(request.tools[0]).toMatchObject({
      type: "web_search_20260318",
      max_uses: 1,
      allowed_callers: ["direct"],
    });
    expect(request.tools[0].allowed_domains).toContain(
      "thisiseindhoven.com"
    );
  });
  expect(result).toMatchObject({ requests: 4 });
  expect(result.candidates[0]).toMatchObject({
    title: "Dutch Design Week",
    sourceState: "active",
    aiImpactPoints: 45,
  });
});

it("rejects Claude discovery for an unconfigured pilot city", async () => {
  await expect(
    collectClaude({
      start: "2026-09-01",
      end: "2026-11-30",
      location: "Utrecht",
      radiusKm: 25,
      model: "claude-test",
      client: { messages: { create: vi.fn() } } as unknown as Anthropic,
    })
  ).rejects.toThrow("Geen vertrouwde Claude-bronnen ingesteld voor Utrecht.");
});
```

- [ ] **Step 2: Run the source tests and confirm failure**

Run:

```powershell
pnpm.cmd vitest run src/features/collection/sources/sources.test.ts
```

Expected: FAIL because discovery makes one broad search, has no domain registry, and does not parse `status`.

- [ ] **Step 3: Create the pilot domain registry**

Create `src/features/collection/sources/trusted-event-domains.ts`:

```ts
import { normalizeText } from "@/features/events/normalize";

const domains: Record<string, string[]> = {
  eindhoven: [
    "thisiseindhoven.com",
    "psv.nl",
    "tue.nl",
    "hightechcampus.com",
    "evoluon.com",
    "effenaar.nl",
    "parktheater.nl",
  ],
  rotterdam: [
    "rotterdamfestivals.nl",
    "uitagendarotterdam.nl",
    "ahoy.nl",
    "feyenoord.nl",
    "dedoelen.nl",
    "eur.nl",
    "rotterdam.nl",
  ],
};

export function trustedEventDomains(location: string) {
  return domains[normalizeText(location)] ?? [];
}
```

- [ ] **Step 4: Implement three bounded Claude searches**

In `src/features/collection/sources/claude.ts`, import `trustedEventDomains`, add `status` to both output schemas, and extend the input type:

```ts
knownUrls?: string[];
```

Add this property to the Zod event schema:

```ts
status: z.enum(["active", "cancelled", "postponed"]),
```

Add the JSON Schema property and include `status` in the event's `required` array:

```ts
status: {
  type: "string",
  enum: ["active", "cancelled", "postponed"],
},
```

Use these search groups:

```ts
const searchGroups = [
  "congressen, vakbeurzen, conferenties, universitaire introducties en open dagen",
  "grote concerten, festivals, arena-evenementen en stadionevenementen",
  "nationale of internationale sporttoernooien en Europese thuiswedstrijden",
] as const;
```

Replace the single search call with:

```ts
const domains = trustedEventDomains(input.location);
if (!domains.length) {
  throw new Error(
    `Geen vertrouwde Claude-bronnen ingesteld voor ${input.location}.`
  );
}

const searches: Anthropic.Message[] = [];
for (const focus of searchGroups) {
  const search = await requestPhase("search", () =>
    client.messages.create(
      {
        model,
        max_tokens: 800,
        tools: [
          {
            type: "web_search_20260318",
            name: "web_search",
            allowed_callers: ["direct"],
            allowed_domains: domains,
            max_uses: 1,
            response_inclusion: "full",
            user_location: {
              type: "approximate",
              country: "NL",
              city: input.location,
              timezone: "Europe/Amsterdam",
            },
          },
        ],
        messages: [
          {
            role: "user",
            content: `Vind binnen ${input.radiusKm} km van ${input.location} tussen ${input.start} en ${input.end} alleen ${focus} met aannemelijke extra hotelvraag. Gebruik pagina's van de organisator, locatie, club, universiteit, federatie of gemeente.`,
          },
        ],
      },
      searchRequestOptions
    )
  );
  await observeUsage(input.onUsage, usageEvent(search, "discovery", model));
  searches.push(search);
}

const urls = [
  ...new Set([
    ...(input.knownUrls ?? []),
    ...searches.flatMap(sourceUrls),
  ]),
].slice(0, 16);
```

Replace the zero-result return so it aggregates all three search calls:

```ts
if (!urls.length) {
  return {
    source: "claude",
    candidates: [],
    requests: searches.length,
    usage: {
      inputTokens: searches.reduce(
        (total, message) => total + message.usage.input_tokens,
        0
      ),
      outputTokens: searches.reduce(
        (total, message) => total + message.usage.output_tokens,
        0
      ),
      webSearchRequests: searches.reduce(
        (total, message) =>
          total + (message.usage.server_tool_use?.web_search_requests ?? 0),
        0
      ),
      webFetchRequests: 0,
    },
  };
}
```

Keep the existing fetch batches, but require `status` in the prompt and map it:

```ts
sourceState: event.status,
```

Return request and usage totals across all search and fetch messages:

```ts
const messages = [...searches, ...verified];
return {
  source: "claude",
  candidates,
  requests: messages.length,
  usage: {
    inputTokens: messages.reduce(
      (total, message) => total + message.usage.input_tokens,
      0
    ),
    outputTokens: messages.reduce(
      (total, message) => total + message.usage.output_tokens,
      0
    ),
    webSearchRequests: messages.reduce(
      (total, message) =>
        total + (message.usage.server_tool_use?.web_search_requests ?? 0),
      0
    ),
    webFetchRequests: messages.reduce(
      (total, message) =>
        total + (message.usage.server_tool_use?.web_fetch_requests ?? 0),
      0
    ),
  },
};
```

Update existing Claude output fixtures in the test file with `status: "active"`.

- [ ] **Step 5: Run the source tests and confirm success**

Run:

```powershell
pnpm.cmd vitest run src/features/collection/sources/sources.test.ts
```

Expected: PASS with all source adapter tests passing.

- [ ] **Step 6: Commit the task**

```powershell
git add -- src/features/collection/sources/trusted-event-domains.ts src/features/collection/sources/claude.ts src/features/collection/sources/sources.test.ts
git commit -m "feat: focus Claude discovery on trusted event sources"
```

---

### Task 3: Refresh stored Claude pages and process cancellations

**Files:**
- Modify: `src/features/collection/repository.ts:66-94`
- Modify: `src/features/collection/run.ts:44-48,179-187`
- Modify: `src/features/collection/run.test.ts:1-49`
- Test: `src/features/collection/sources/sources.test.ts`

**Interfaces:**
- Produces: `selectClaudeRefreshUrls(rows, window, limit?): string[]`
- Extends: `CollectionContext` with `knownClaudeUrls: string[]`
- Consumes: Task 2 `collectClaude({ knownUrls })`

- [ ] **Step 1: Write failing stored-page selection tests**

Add to `src/features/collection/run.test.ts`:

```ts
import { selectClaudeRefreshUrls } from "./repository";

it("selects the oldest unique Claude pages inside the active window", () => {
  const rows = [
    {
      source_url: "https://venue.nl/oldest",
      extracted_start_at: "2026-10-10T10:00:00Z",
      extracted_end_at: "2026-10-11T20:00:00Z",
      checked_at: "2026-08-01T00:00:00Z",
    },
    {
      source_url: "https://venue.nl/newer",
      extracted_start_at: "2026-11-10T10:00:00Z",
      extracted_end_at: "2026-11-10T22:00:00Z",
      checked_at: "2026-08-15T00:00:00Z",
    },
    {
      source_url: "https://venue.nl/oldest",
      extracted_start_at: "2026-10-10T10:00:00Z",
      extracted_end_at: "2026-10-11T20:00:00Z",
      checked_at: "2026-08-20T00:00:00Z",
    },
    {
      source_url: "https://venue.nl/outside",
      extracted_start_at: "2027-01-10T10:00:00Z",
      extracted_end_at: "2027-01-10T20:00:00Z",
      checked_at: "2026-07-01T00:00:00Z",
    },
  ];

  expect(
    selectClaudeRefreshUrls(
      rows,
      { start: "2026-09-01", end: "2026-11-30" },
      2
    )
  ).toEqual(["https://venue.nl/oldest", "https://venue.nl/newer"]);
});
```

Add a source test that passes `knownUrls: ["https://venue.nl/known-event"]` and asserts that the fetch request prompt contains that URL even when search responses omit it.

- [ ] **Step 2: Run focused tests and confirm failure**

Run:

```powershell
pnpm.cmd vitest run src/features/collection/run.test.ts src/features/collection/sources/sources.test.ts
```

Expected: FAIL because `selectClaudeRefreshUrls` and `CollectionContext.knownClaudeUrls` do not exist.

- [ ] **Step 3: Implement bounded stored-page selection**

Add to `src/features/collection/repository.ts`:

```ts
type ClaudeSourceRow = {
  source_url: string;
  extracted_start_at: string;
  extracted_end_at: string | null;
  checked_at: string;
};

export function selectClaudeRefreshUrls(
  rows: ClaudeSourceRow[],
  window: CollectionWindow,
  limit = 8
) {
  return [
    ...new Map(
      rows
        .filter(
          (row) =>
            row.extracted_start_at.slice(0, 10) <= window.end &&
            (row.extracted_end_at ?? row.extracted_start_at).slice(0, 10) >=
              window.start
        )
        .sort((left, right) => left.checked_at.localeCompare(right.checked_at))
        .map((row) => [row.source_url, row] as const)
    ).keys(),
  ].slice(0, limit);
}
```

Import `CollectionWindow` from `./types`.

Inside `loadContext`, after loading the area and hotel, load the current area's linked event IDs and Claude evidence:

```ts
const { data: links, error: linkError } = await supabase
  .from("account_event_areas")
  .select("event_id")
  .eq("account_id", accountId)
  .eq("collection_area_id", areaId);
if (linkError) throw linkError;

const claudeSources = links.length
  ? await fetchInBatches(
      links.map((link) => link.event_id),
      (ids) =>
        supabase
          .from("event_sources")
          .select(
            "source_url, extracted_start_at, extracted_end_at, checked_at"
          )
          .eq("provider", "claude")
          .in("event_id", ids)
    )
  : [];
```

Return:

```ts
knownClaudeUrls: selectClaudeRefreshUrls(claudeSources, window),
```

- [ ] **Step 4: Pass stored pages to Claude**

Extend `CollectionContext` in `src/features/collection/run.ts`:

```ts
knownClaudeUrls: string[];
```

Pass the URLs in the default Claude collector:

```ts
knownUrls: context.knownClaudeUrls,
```

Add `knownClaudeUrls: []` to the shared repository fixture in `run.test.ts`.

In the Claude fetch prompt, require the status contract:

```ts
content: `Open deze pagina's en controleer per evenement titel, datum, locatie en status. Gebruik status active, cancelled of postponed. Neem alleen evenementen in het venster op. Geef impactPoints 20, 35, 45 of 60 als de pagina zelf schaal, capaciteit of landelijke of internationale aantrekkingskracht ondersteunt; gebruik null zonder zo'n signaal. Pagina's:\n${batch.join("\n")}`,
```

- [ ] **Step 5: Prove an official cancellation maps to exclusion input**

Add a source test response with `status: "cancelled"` and assert:

```ts
expect(result.candidates[0]).toMatchObject({
  sourceState: "cancelled",
  provider: "claude",
});
```

The existing `validateCandidate` and repository automation handle cancellation exclusion, so do not add a second cancellation path.

- [ ] **Step 6: Run focused tests and confirm success**

Run:

```powershell
pnpm.cmd vitest run src/features/collection/run.test.ts src/features/collection/sources/sources.test.ts src/features/events/events.test.ts
```

Expected: PASS with all listed files passing.

- [ ] **Step 7: Commit the task**

```powershell
git add -- src/features/collection/repository.ts src/features/collection/run.ts src/features/collection/run.test.ts src/features/collection/sources/claude.ts src/features/collection/sources/sources.test.ts
git commit -m "feat: refresh active Claude event sources"
```

---

### Task 4: Hide weak demand from subscriber calendar and export

**Files:**
- Modify: `src/features/events/importance.ts`
- Test: `src/features/events/events.test.ts`
- Modify: `src/features/calendar/query.ts:100-165`
- Modify: `src/features/export/types.ts`
- Modify: `src/features/export/query.ts:29-57`
- Modify: `src/features/export/map-rows.ts:8-29`
- Test: `src/features/export/export.test.ts:8-38`

**Interfaces:**
- Produces: `isPublishableDemand(importance: DemandLevel, impactBasis: string): boolean`
- Extends: `ExportEvent.hotels[]` with `impactBasis: string`
- Consumes: final importance after any explicit override

- [ ] **Step 1: Write failing publishability tests**

Add to `src/features/events/events.test.ts`:

```ts
import { isPublishableDemand } from "./importance";

it("publishes Medium demand with evidence and hides Low or default demand", () => {
  expect(isPublishableDemand("Medium", "attendance")).toBe(true);
  expect(isPublishableDemand("High", "ai_assessment")).toBe(true);
  expect(isPublishableDemand("Medium", "default")).toBe(false);
  expect(isPublishableDemand("Low", "attendance")).toBe(false);
});
```

Extend the export fixture with weak hotels:

```ts
{ id: "hotel-4", code: "LOW", importance: "Low", impactBasis: "attendance" },
{ id: "hotel-5", code: "DEFAULT", importance: "Medium", impactBasis: "default" },
```

Add `impactBasis: "attendance"` to the three existing hotel fixtures, pass all five IDs, and retain the existing workbook expectations. The expected workbook must contain neither `LOW` nor `DEFAULT`.

- [ ] **Step 2: Run event and export tests and confirm failure**

Run:

```powershell
pnpm.cmd vitest run src/features/events/events.test.ts src/features/export/export.test.ts
```

Expected: FAIL because `isPublishableDemand` does not exist and export rows include weak scores.

- [ ] **Step 3: Implement the shared rule**

Add to `src/features/events/importance.ts`:

```ts
export function isPublishableDemand(
  importance: DemandLevel,
  impactBasis: string
) {
  return importance !== "Low" && impactBasis !== "default";
}
```

- [ ] **Step 4: Apply the rule to calendar data**

Import `isPublishableDemand` in `src/features/calendar/query.ts`. After mapping each event's `hotelScores`, filter the scores:

```ts
const hotelScores = scores
  .filter((score) => score.event_id === event.id)
  .map((score) => ({
    hotelId: score.hotel_id,
    hotelName: selectedHotelName,
    total: score.total,
    importance: (score.importance_override ??
      score.suggested_importance) as DemandLevel,
    impactBasis: score.impact_basis,
    impactPoints: score.impact_points,
    distancePoints: score.distance_points,
    stayPressurePoints: score.stay_pressure_points,
    distanceKm: score.distance_km,
  }))
  .filter((score) =>
    isPublishableDemand(score.importance, score.impactBasis)
  );
```

- [ ] **Step 5: Apply the rule to RevControl export**

Extend `ExportEvent.hotels` in `src/features/export/types.ts`:

```ts
hotels: Array<{
  id: string;
  code: string;
  importance: DemandLevel;
  impactBasis: string;
}>;
```

In `src/features/export/query.ts`, select `impact_basis` and map it:

```ts
fetchInBatches(eventIds, (ids) =>
  supabase
    .from("hotel_event_scores")
    .select(
      "event_id, hotel_id, suggested_importance, importance_override, impact_basis"
    )
    .in("event_id", ids)
    .in("hotel_id", selectedHotelIds)
)
```

```ts
impactBasis: score.impact_basis,
```

Import `isPublishableDemand` in `src/features/export/map-rows.ts` and filter before grouping:

```ts
event.hotels.forEach((hotel) => {
  if (
    !selected.has(hotel.id) ||
    !isPublishableDemand(hotel.importance, hotel.impactBasis)
  ) {
    return;
  }
  const importance =
    hotel.importance === "Peak" ? "High" : hotel.importance;
  groups.set(importance, [...(groups.get(importance) ?? []), hotel.code]);
});
```

- [ ] **Step 6: Run focused tests and confirm success**

Run:

```powershell
pnpm.cmd vitest run src/features/events/events.test.ts src/features/calendar/calendar-view.test.tsx src/features/export/export.test.ts
```

Expected: PASS with all listed files passing.

- [ ] **Step 7: Commit the task**

```powershell
git add -- src/features/events/importance.ts src/features/events/events.test.ts src/features/calendar/query.ts src/features/export/types.ts src/features/export/query.ts src/features/export/map-rows.ts src/features/export/export.test.ts
git commit -m "feat: publish only evidence-backed demand events"
```

---

### Task 5: Update the pilot runbook and verify the full change

**Files:**
- Modify: `docs/pilot-runbook.md`

**Interfaces:**
- Consumes: existing per-hotel PredictHQ and Claude source checkboxes
- Produces: four-cycle pilot procedure and read-only comparison query

- [ ] **Step 1: Replace obsolete 12-month and review gates**

Update the runbook table so it requires these gates:

```markdown
| 4 | Disable PredictHQ on the pilot hotels until written permission covers the intended use. |  |  |  |  |
| 5 | Freeze the Eindhoven and Rotterdam known-event benchmark from Robert's existing calendars, exports, and known high-demand dates. |  |  |  |  |
| 6 | Run four collection cycles over rolling 90-day windows and record source failures and Claude cost. |  |  |  |  |
| 7 | Confirm displayed and exported events are Medium or higher and use a non-default impact basis. |  |  |  |  |
| 8 | Confirm Low, default-basis, unsupported, and conflicted events stay out of subscriber output. |  |  |  |  |
| 9 | Confirm one official cancellation leaves the subscriber calendar without a manager review task. |  |  |  |  |
| 10 | Import the generated workbook into RevControl without repairing headers or dates. |  |  |  |  |
| 11 | If PredictHQ grants permission, enable it with the existing source control and run one paired comparison over the same 90-day window. |  |  |  |  |
| 12 | Record unique Medium-or-higher events by source, benchmark misses, false positives, failures, and cost per accepted event. |  |  |  |  |
```

Keep the account-isolation, build, design-token, and RevControl gates.

- [ ] **Step 2: Add the aggregate comparison query**

Add this read-only query to `docs/pilot-runbook.md`:

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

- [ ] **Step 3: Run the complete verification suite**

Run:

```powershell
pnpm.cmd test
pnpm.cmd typecheck
pnpm.cmd lint
pnpm.cmd build
git diff --check
```

Expected:

- Vitest reports all test files and tests passing.
- TypeScript exits with code 0.
- ESLint exits with code 0.
- Next.js completes the production build.
- `git diff --check` prints no errors.

- [ ] **Step 4: Perform the required simplification pass**

Confirm the final diff contains none of these:

```text
version-mode database field
new package dependency
subscriber review UI
trusted-source admin UI
second Claude collector
new worker service
```

If any item appears, remove it unless a test proves the approved design requires it.

- [ ] **Step 5: Commit the runbook and final adjustments**

```powershell
git add -- docs/pilot-runbook.md
git commit -m "docs: update the 90-day discovery pilot runbook"
```

- [ ] **Step 6: Inspect the final branch state**

Run:

```powershell
git status --short
git log -6 --oneline
```

Expected: no tracked changes remain. The pre-existing `supabase/snippets/` directory remains untracked and untouched.
