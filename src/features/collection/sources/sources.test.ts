import { describe, expect, it, vi, type Mock } from "vitest";
import {
  APIConnectionTimeoutError,
  type default as Anthropic,
} from "@anthropic-ai/sdk";

import openHolidaysFixture from "../../../../tests/fixtures/openholidays.json";
import predictHqFixture from "../../../../tests/fixtures/predicthq.json";
import rijksoverheidFixture from "../../../../tests/fixtures/rijksoverheid.json";
import ticketmasterFixture from "../../../../tests/fixtures/ticketmaster.json";
import {
  claudeProviderEventId,
  collectClaude,
  triagePredictHqCandidates,
  verifyPredictHqCandidates,
} from "./claude";
import { collectOpenHolidays } from "./openholidays";
import { collectPredictHq } from "./predicthq";
import { collectRijksoverheid } from "./rijksoverheid";
import { collectTicketmaster } from "./ticketmaster";

const jsonResponse = (value: unknown) =>
  new Response(JSON.stringify(value), { status: 200 });
const window = { start: "2027-01-01", end: "2027-12-31" };
const claudeWindow = { start: "2027-08-01", end: "2027-10-30" };

const fetchResult = (url: string) => ({
  type: "web_fetch_tool_result",
  content: { type: "web_fetch_result", url },
});

const discoveredCandidate = (overrides: Record<string, unknown> = {}) => ({
  title: "Dutch Design Week",
  startDate: "2027-09-15",
  endDate: "2027-09-23",
  city: "Eindhoven",
  venue: "Klokgebouw",
  category: "festival",
  officialUrl: null,
  ...overrides,
});

const discoveryResponse = (
  candidates: Array<Record<string, unknown>> = [],
  agendaUrls: string[] = [],
) => ({
  content: [
    {
      type: "web_search_tool_result",
      content: [
        ...candidates.flatMap((candidate) =>
          candidate.officialUrl
            ? [{ type: "web_search_result", url: candidate.officialUrl }]
            : [],
        ),
        ...agendaUrls.map((url) => ({ type: "web_search_result", url })),
      ],
    },
    { type: "text", text: JSON.stringify({ candidates, agendaUrls }) },
  ],
  usage: {
    input_tokens: 100,
    output_tokens: 20,
    server_tool_use: { web_search_requests: 1 },
  },
});

function queueClaudeSearches(
  create: Mock,
  candidates: Array<Record<string, unknown>> = [],
  agendaUrls: string[] = [],
) {
  create.mockResolvedValueOnce(discoveryResponse(candidates, agendaUrls));
  for (let index = 1; index < 12; index += 1) {
    create.mockResolvedValueOnce(discoveryResponse());
  }
}

const agendaResponse = (url: string, candidates: Array<Record<string, unknown>>) => ({
  content: [
    fetchResult(url),
    { type: "text", text: JSON.stringify({ candidates, agendaUrls: [] }) },
  ],
  usage: {
    input_tokens: 400,
    output_tokens: 120,
    server_tool_use: { web_fetch_requests: 1 },
  },
});

const verifiedEvent = (overrides: Record<string, unknown> = {}) => ({
  sourceUrl: "https://organizer.example/event",
  title: "Dutch Design Week",
  category: "festival",
  venue: "Klokgebouw",
  latitude: 51.44,
  longitude: 5.48,
  regionScope: null,
  startAt: "2027-09-15T10:00:00+02:00",
  endAt: "2027-09-23T22:00:00+02:00",
  status: "active",
  ownerType: "organizer",
  evidenceText: "Meerdaagse internationale editie.",
  impactPoints: 60,
  titleConfirmed: true,
  dateConfirmed: true,
  locationConfirmed: true,
  ...overrides,
});

const verificationResponse = (
  fetchedUrl: string | null,
  events: Array<Record<string, unknown>>,
) => ({
  content: [
    ...(fetchedUrl ? [fetchResult(fetchedUrl)] : []),
    { type: "text", text: JSON.stringify({ events }) },
  ],
  usage: {
    input_tokens: 200,
    output_tokens: 80,
    server_tool_use: { web_fetch_requests: 1 },
  },
});

describe("source adapters", () => {
  it("maps school holidays from Rijksoverheid", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(jsonResponse(rijksoverheidFixture));
    const result = await collectRijksoverheid({ ...window, fetcher });
    expect(result.requests).toBe(1);
    expect(result.candidates).toMatchObject([
      { category: "school_holiday", regionScope: "south" },
    ]);
  });

  it("maps Dutch public holidays in the window", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(jsonResponse(openHolidaysFixture));
    const result = await collectOpenHolidays({ ...window, fetcher });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      title: "Nieuwjaarsdag",
      category: "public_holiday",
    });
  });

  it("maps Ticketmaster status and stops at the last page", async () => {
    const secondPage = {
      _embedded: { events: [] },
      page: { number: 1, totalPages: 2, totalElements: 2 },
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(ticketmasterFixture))
      .mockResolvedValueOnce(jsonResponse(secondPage));
    const result = await collectTicketmaster({
      ...window,
      city: "Eindhoven",
      latitude: 51.44,
      longitude: 5.48,
      radiusKm: 25,
      apiKey: "test",
      fetcher,
    });
    expect(result.requests).toBe(2);
    expect(result.candidates.map((event) => event.sourceState)).toEqual([
      "active",
      "cancelled",
    ]);
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.searchParams.get("latlong")).toBe("51.44,5.48");
    expect(url.searchParams.get("radius")).toBe("25");
    expect(url.searchParams.get("unit")).toBe("km");
    expect(url.searchParams.has("city")).toBe(false);
  });

  it("keeps PredictHQ predicted events provisional", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(predictHqFixture));
    const result = await collectPredictHq({
      ...window,
      latitude: 51.44,
      longitude: 5.48,
      radiusKm: 30,
      accessToken: "test",
      fetcher,
    });
    expect(result.candidates[1]).toMatchObject({
      sourceState: "predicted",
      certainty: "provisional",
      localRank: 60,
    });
    expect(result.candidates[2]).toMatchObject({
      sourceState: "removed",
      providerDeletedReason: "duplicate",
      providerDuplicateOfId: "phq-1",
      venue: "Klokgebouw",
      publicSourceUrl: null,
      primarySourceConfirmed: false,
    });
  });

  it("accepts PredictHQ plans that omit local rank and attendance", async () => {
    const fixture = structuredClone(predictHqFixture) as {
      results: Array<Record<string, unknown>>;
    };
    delete fixture.results[0].local_rank;
    delete fixture.results[0].phq_attendance;
    const result = await collectPredictHq({
      ...window,
      latitude: 51.44,
      longitude: 5.48,
      radiusKm: 30,
      accessToken: "test",
      fetcher: vi.fn().mockResolvedValue(jsonResponse(fixture)),
    });
    expect(result.candidates[0]).toMatchObject({
      localRank: null,
      attendance: null,
    });
  });

  it("searches any requested city in twelve bounded month/category slices", async () => {
    const official = "https://www.jaarbeurs.nl/event";
    const agendaUrl = "https://www.uitagendautrecht.nl/oktober";
    const agendaOfficial = "https://www.tivolivredenburg.nl/agenda/event";
    const nameOnlyUrl = "https://www.fcutrecht.nl/wedstrijd";
    const create = vi.fn();
    queueClaudeSearches(
      create,
      [
        discoveredCandidate({ title: "Vakbeurs Utrecht", city: "Utrecht", venue: "Jaarbeurs", officialUrl: official }),
        discoveredCandidate({ title: "Naamloos concert", city: "Utrecht", venue: "TivoliVredenburg", officialUrl: null }),
      ],
      [agendaUrl],
    );
    create.mockResolvedValueOnce(
      agendaResponse(agendaUrl, [
        discoveredCandidate({ title: "Agenda-item", city: "Utrecht", officialUrl: agendaOfficial }),
      ]),
    );
    create
      .mockResolvedValueOnce(
        verificationResponse(official, [
          verifiedEvent({
            sourceUrl: "https://invented.example/event",
            title: "Vakbeurs Utrecht",
            category: "expos",
            venue: "Jaarbeurs",
            impactPoints: 45,
          }),
        ]),
      )
      .mockResolvedValueOnce(
        verificationResponse(agendaOfficial, [
          verifiedEvent({ sourceUrl: agendaOfficial, title: "Agenda-item", ownerType: "other" }),
        ]),
      )
      .mockResolvedValueOnce(
        verificationResponse(nameOnlyUrl, [
          verifiedEvent({ sourceUrl: nameOnlyUrl, title: "Naamloos concert", ownerType: "club", impactPoints: 20 }),
        ]),
      );

    const result = await collectClaude({
      ...claudeWindow,
      location: "Utrecht",
      radiusKm: 25,
      model: "claude-sonnet-5",
      client: { messages: { create } } as unknown as Anthropic,
      triage: async () => new Map<number, string>(),
    });

    expect(create).toHaveBeenCalledTimes(16);
    create.mock.calls.slice(0, 12).forEach(([request]) => {
      expect(request.max_tokens).toBe(2_500);
      expect(request.tools[0]).toMatchObject({
        type: "web_search_20260318",
        allowed_callers: ["direct"],
        max_uses: 1,
        response_inclusion: "full",
      });
      expect(request.tools[0]).not.toHaveProperty("allowed_domains");
      expect(request.tools[0].user_location).toEqual({
        type: "approximate",
        country: "NL",
        city: "Utrecht",
        timezone: "Europe/Amsterdam",
      });
      expect(request.tool_choice).toBeUndefined();
      expect(request.thinking).toEqual({ type: "disabled" });
      expect(request.output_config.format).toMatchObject({ type: "json_schema" });
    });
    expect(create.mock.calls[0][1]).toEqual({ timeout: 180_000, maxRetries: 1 });
    expect(create.mock.calls[0][0].messages[0].content).toContain("2027-08-01 en 2027-08-30");
    expect(create.mock.calls[0][0].messages[0].content).toContain("augustus 2027");
    expect(create.mock.calls[4][0].messages[0].content).toContain("2027-08-31 en 2027-09-29");
    expect(create.mock.calls[8][0].messages[0].content).toContain("2027-09-30 en 2027-10-30");
    expect(create.mock.calls[8][0].messages[0].content).toContain("september 2027");
    expect(create.mock.calls[3][0].messages[0].content).toContain("bevestigde professionele sportwedstrijden");

    const agendaRequest = create.mock.calls[12][0];
    expect(agendaRequest.messages[0].content).toContain(agendaUrl);
    expect(agendaRequest.tools[0]).toMatchObject({
      type: "web_fetch_20260318",
      max_uses: 1,
      max_content_tokens: 6_000,
    });

    const urlVerification = create.mock.calls[13][0];
    expect(create.mock.calls[13][1]).toEqual({ timeout: 180_000, maxRetries: 0 });
    expect(urlVerification.max_tokens).toBe(2_000);
    expect(urlVerification.thinking).toEqual({ type: "disabled" });
    expect(urlVerification.tools).toEqual([{
      type: "web_fetch_20260318",
      name: "web_fetch",
      allowed_callers: ["direct"],
      max_uses: 2,
      max_content_tokens: 6_000,
      citations: { enabled: false },
      response_inclusion: "full",
    }]);
    expect(urlVerification.tool_choice).toBeUndefined();
    expect(urlVerification.messages[0].content).toContain(official);
    expect(
      JSON.stringify(urlVerification.output_config.format.schema),
    ).not.toContain('"enum":[20');

    const nameVerification = create.mock.calls[15][0];
    expect(nameVerification.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "web_fetch",
      "web_search",
    ]);
    expect(nameVerification.messages[0].content).toContain("Naamloos concert");

    expect(result.requests).toBe(16);
    expect(result.usage.webSearchRequests).toBe(12);
    expect(result.usage.webFetchRequests).toBe(4);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      sourceUrl: official,
      title: "Vakbeurs Utrecht",
      sourceState: "active",
      primarySourceConfirmed: true,
      aiImpactPoints: 45,
    });
    expect(result.funnel).toMatchObject({
      namesDiscovered: 3,
      urlsResolved: 3,
      pagesVerified: 2,
      demandAccepted: 1,
    });
  });

  it("rejects an official URL that Claude searched but never fetched", async () => {
    const official = "https://official.example/event";
    const create = vi.fn();
    queueClaudeSearches(create, [discoveredCandidate({ officialUrl: official })]);
    create.mockResolvedValueOnce({
      content: [
        {
          type: "web_search_tool_result",
          content: [{ type: "web_search_result", url: official }],
        },
        { type: "text", text: JSON.stringify({ events: [verifiedEvent({ sourceUrl: official })] }) },
      ],
      usage: {
        input_tokens: 200,
        output_tokens: 80,
        server_tool_use: { web_fetch_requests: 1 },
      },
    });

    const result = await collectClaude({
      ...claudeWindow,
      location: "Eindhoven",
      radiusKm: 25,
      model: "claude-test",
      client: { messages: { create } } as unknown as Anthropic,
      triage: async () => new Map<number, string>(),
    });

    expect(result.candidates).toEqual([]);
    expect(result.funnel?.urlsResolved).toBe(0);
    expect(result.funnel?.drops).toEqual([
      { title: "Dutch Design Week", stage: "verification", reason: "Geen gefetchte officiële URL." },
    ]);
  });

  it("reads aggregator agenda pages for names that no search snippet returned", async () => {
    const agendaUrl = "https://uitagenda.example/oktober";
    const glow = "https://gloweindhoven.nl/en/practical/";
    const create = vi.fn();
    queueClaudeSearches(create, [], [agendaUrl]);
    create.mockResolvedValueOnce(
      agendaResponse(agendaUrl, [
        discoveredCandidate({ title: "GLOW", startDate: "2027-10-10", endDate: "2027-10-17" }),
      ]),
    );
    create.mockResolvedValueOnce(
      verificationResponse(glow, [
        verifiedEvent({
          sourceUrl: glow,
          title: "GLOW",
          startAt: "2027-10-10T18:00:00+02:00",
          endAt: "2027-10-17T23:00:00+02:00",
        }),
      ]),
    );

    const result = await collectClaude({
      ...claudeWindow,
      location: "Eindhoven",
      radiusKm: 25,
      model: "claude-test",
      client: { messages: { create } } as unknown as Anthropic,
      triage: async () => new Map<number, string>(),
    });

    expect(create).toHaveBeenCalledTimes(14);
    expect(create.mock.calls[12][0].messages[0].content).toContain(agendaUrl);
    expect(create.mock.calls[13][0].tools.map((tool: { name: string }) => tool.name)).toEqual([
      "web_fetch",
      "web_search",
    ]);
    expect(create.mock.calls[13][0].messages[0].content).toContain("GLOW");
    expect(result.candidates).toMatchObject([{ title: "GLOW", sourceUrl: glow }]);
    expect(result.funnel).toMatchObject({
      namesDiscovered: 1,
      urlsResolved: 1,
      pagesVerified: 1,
      demandAccepted: 1,
    });
  });

  it("records a drop reason for every rejected candidate", async () => {
    const urls = [
      "https://a.example/event",
      "https://b.example/event",
      "https://c.example/event",
    ];
    const create = vi.fn();
    queueClaudeSearches(
      create,
      urls.map((url, index) => discoveredCandidate({ title: `Kandidaat ${index}`, officialUrl: url })),
    );
    create
      .mockResolvedValueOnce(
        verificationResponse(urls[0], [verifiedEvent({ sourceUrl: urls[0], ownerType: "other" })]),
      )
      .mockResolvedValueOnce(
        verificationResponse(urls[1], [verifiedEvent({ sourceUrl: urls[1], impactPoints: 20 })]),
      )
      .mockRejectedValueOnce(new Error("403 Forbidden"));

    const result = await collectClaude({
      ...claudeWindow,
      location: "Eindhoven",
      radiusKm: 25,
      model: "claude-test",
      client: { messages: { create } } as unknown as Anthropic,
      triage: async () => new Map<number, string>(),
    });

    expect(result.candidates).toEqual([]);
    expect(result.funnel?.drops).toEqual([
      { title: "Kandidaat 2", stage: "verification", reason: "Fetch mislukt: 403 Forbidden" },
      { title: "Kandidaat 0", stage: "verification", reason: "Pagina is geen eigenaarspagina (ownerType other)." },
      { title: "Kandidaat 1", stage: "verification", reason: "Geen aantoonbare hotelvraag (impactPoints 20)." },
    ]);
    expect(result.funnel?.demandAccepted).toBe(0);
  });

  it("stops giving the search tool to name-only candidates past the search budget", async () => {
    const names = Array.from({ length: 22 }, (_, index) =>
      discoveredCandidate({ title: `Evenement ${index}`, startDate: "2027-09-01", endDate: null }),
    );
    const create = vi.fn();
    for (let index = 0; index < 12; index += 1) {
      create.mockResolvedValueOnce(discoveryResponse(names.slice(index * 6, index * 6 + 6)));
    }
    create.mockResolvedValue(verificationResponse("https://organizer.example/event", []));

    const result = await collectClaude({
      ...claudeWindow,
      location: "Eindhoven",
      radiusKm: 25,
      model: "claude-test",
      client: { messages: { create } } as unknown as Anthropic,
      triage: async () => new Map<number, string>(),
    });

    expect(create).toHaveBeenCalledTimes(32);
    const verificationCalls = create.mock.calls.slice(12);
    expect(
      verificationCalls.filter(([request]) =>
        request.tools.some((tool: { name: string }) => tool.name === "web_search"),
      ),
    ).toHaveLength(20);
    expect(result.funnel?.drops).toEqual([
      { title: "Evenement 20", stage: "resolution", reason: "Zoekbudget voor officiële pagina's bereikt." },
      { title: "Evenement 21", stage: "resolution", reason: "Zoekbudget voor officiële pagina's bereikt." },
    ]);
  });

  it("merges title variants of one event into a single candidate", async () => {
    const official = "https://ddw.nl/en";
    const create = vi.fn();
    queueClaudeSearches(create, [
      discoveredCandidate({ title: "Dutch Design Week 2026", startDate: "2027-09-15", endDate: "2027-09-23" }),
      discoveredCandidate({ title: "Dutch Design Week (DDW26) - R.A.W.", startDate: "2027-09-17", endDate: "2027-09-23", officialUrl: official }),
      discoveredCandidate({ title: "Dutch Design Week", startDate: "2027-09-15", endDate: null }),
    ]);
    create.mockResolvedValue(verificationResponse(official, []));

    const result = await collectClaude({
      ...claudeWindow,
      location: "Eindhoven",
      radiusKm: 25,
      model: "claude-test",
      client: { messages: { create } } as unknown as Anthropic,
      triage: async () => new Map<number, string>(),
    });

    expect(result.funnel?.namesDiscovered).toBe(1);
    expect(create).toHaveBeenCalledTimes(13);
    const verification = create.mock.calls[12][0];
    expect(verification.messages[0].content).toContain(official);
    expect(verification.tools.map((tool: { name: string }) => tool.name)).toEqual(["web_fetch"]);
  });

  it("verifies freshly discovered candidates before refreshing known pages", async () => {
    const official = "https://organizer.nl/festival";
    const knownUrl = "https://venue.nl/known-event";
    const create = vi.fn();
    queueClaudeSearches(create, [discoveredCandidate({ officialUrl: official })]);
    create.mockResolvedValue(verificationResponse(official, []));

    await collectClaude({
      ...claudeWindow,
      location: "Eindhoven",
      radiusKm: 25,
      model: "claude-test",
      knownUrls: [knownUrl],
      client: { messages: { create } } as unknown as Anthropic,
      triage: async () => new Map<number, string>(),
    });

    expect(create.mock.calls[12][0].messages[0].content).toContain(official);
    expect(create.mock.calls[13][0].messages[0].content).toContain(knownUrl);
  });

  it("confirms current-edition dates from a second official owner page", async () => {
    const organizer = "https://asmlmarathoneindhoven.nl/";
    const municipality = "https://www.eindhoven.nl/evenementen/marathon";
    const create = vi.fn();
    queueClaudeSearches(create, [
      discoveredCandidate({
        title: "ASML Marathon Eindhoven",
        startDate: "2027-09-18",
        endDate: "2027-09-19",
        officialUrl: organizer,
      }),
    ]);
    create.mockResolvedValueOnce({
      content: [
        fetchResult(organizer),
        fetchResult(municipality),
        {
          type: "text",
          text: JSON.stringify({
            events: [verifiedEvent({
              sourceUrl: organizer,
              title: "ASML Marathon Eindhoven",
              startAt: "2027-09-18T09:00:00+02:00",
              endAt: "2027-09-19T18:00:00+02:00",
              evidenceText: "De gemeentepagina bevestigt de data van de huidige editie.",
            })],
          }),
        },
      ],
      usage: { input_tokens: 300, output_tokens: 100, server_tool_use: { web_fetch_requests: 2 } },
    });

    const result = await collectClaude({
      ...claudeWindow,
      location: "Eindhoven",
      radiusKm: 25,
      model: "claude-test",
      client: { messages: { create } } as unknown as Anthropic,
      triage: async () => new Map<number, string>(),
    });

    const verification = create.mock.calls[12][0];
    expect(verification.tools[0]).toMatchObject({ name: "web_fetch", max_uses: 2 });
    expect(verification.messages[0].content).toContain("tweede web_fetch");
    expect(result.candidates).toMatchObject([{
      sourceUrl: organizer,
      title: "ASML Marathon Eindhoven",
      primarySourceConfirmed: true,
      aiImpactPoints: 60,
    }]);
    expect(result.funnel).toMatchObject({ pagesVerified: 1, demandAccepted: 1 });
  });

  it("names the missing confirmation and strips the URL fragment", async () => {
    const plain = "https://asmlmarathoneindhoven.nl/";
    const fragment = `${plain}#:~:text=Zaterdag%2011%20oktober%202025`;
    const create = vi.fn();
    queueClaudeSearches(create, [
      discoveredCandidate({ title: "ASML Marathon Eindhoven", officialUrl: plain }),
    ]);
    create.mockResolvedValueOnce({
      content: [
        fetchResult(fragment),
        {
          type: "text",
          text: JSON.stringify({
            events: [verifiedEvent({
              sourceUrl: fragment,
              title: "ASML Marathon Eindhoven",
              ownerType: "organizer",
              dateConfirmed: false,
            })],
          }),
        },
      ],
      usage: { input_tokens: 200, output_tokens: 80, server_tool_use: { web_fetch_requests: 1 } },
    });

    const result = await collectClaude({
      ...claudeWindow,
      location: "Eindhoven",
      radiusKm: 25,
      model: "claude-test",
      client: { messages: { create } } as unknown as Anthropic,
      triage: async () => new Map<number, string>(),
    });

    expect(result.candidates).toMatchObject([{ sourceUrl: plain, primarySourceConfirmed: false }]);
    expect(result.funnel?.pagesVerified).toBe(0);
    expect(result.funnel?.drops).toEqual([{
      title: "ASML Marathon Eindhoven",
      stage: "verification",
      reason: `Niet bevestigd op ${plain} (ontbreekt: datum, ownerType organizer).`,
    }]);
  });


  it("harvests the venue agenda derived from a discovered event page", async () => {
    const eventPage = "https://www.klokgebouw.nl/agenda/de-nacht-van-strijp-s-2026";
    const agendaRoot = "https://www.klokgebouw.nl/agenda";
    const harvested = "https://www.klokgebouw.nl/agenda/helldorado-2026";
    const create = vi.fn();
    queueClaudeSearches(create, [
      discoveredCandidate({ title: "De Nacht van Strijp-S", officialUrl: eventPage }),
    ]);
    create.mockResolvedValueOnce(agendaResponse(agendaRoot, [
      discoveredCandidate({
        title: "Helldorado",
        startDate: "2027-09-20",
        endDate: "2027-09-20",
        officialUrl: harvested,
      }),
    ]));
    create.mockResolvedValue(verificationResponse(eventPage, []));

    const result = await collectClaude({
      ...claudeWindow,
      location: "Eindhoven",
      radiusKm: 25,
      model: "claude-test",
      client: { messages: { create } } as unknown as Anthropic,
      triage: async () => new Map<number, string>(),
    });

    expect(create.mock.calls[12][0].messages[0].content).toContain(agendaRoot);
    expect(result.funnel?.namesDiscovered).toBe(2);
    const verificationTargets = create.mock.calls
      .slice(13)
      .map(([request]) => request.messages[0].content as string);
    expect(verificationTargets.some((content) => content.includes(harvested))).toBe(true);
  });


  it("harvests a listing page even when a candidate claims it as its official page", async () => {
    const agendaRoot = "https://www.klokgebouw.nl/agenda";
    const harvested = "https://www.klokgebouw.nl/agenda/helldorado-2026";
    const create = vi.fn();
    queueClaudeSearches(
      create,
      [discoveredCandidate({ title: "Evenementen in het Klokgebouw", officialUrl: agendaRoot })],
      [agendaRoot],
    );
    create.mockResolvedValueOnce(agendaResponse(agendaRoot, [
      discoveredCandidate({
        title: "Helldorado",
        startDate: "2027-09-20",
        endDate: "2027-09-20",
        officialUrl: harvested,
      }),
    ]));
    create.mockResolvedValue(verificationResponse(harvested, []));

    const result = await collectClaude({
      ...claudeWindow,
      location: "Eindhoven",
      radiusKm: 25,
      model: "claude-test",
      client: { messages: { create } } as unknown as Anthropic,
      triage: async () => new Map<number, string>(),
    });

    expect(create.mock.calls[12][0].messages[0].content).toContain(agendaRoot);
    expect(result.funnel?.namesDiscovered).toBe(2);
    const verificationTargets = create.mock.calls
      .slice(13)
      .map(([request]) => request.messages[0].content as string);
    expect(verificationTargets.some((content) => content.includes(harvested))).toBe(true);
  });

  it("verifies only the candidates that survive metadata triage", async () => {
    const festival = "https://organizer.nl/festival";
    const clubNight = "https://venue.nl/club-night";
    const create = vi.fn();
    queueClaudeSearches(create, [
      discoveredCandidate({ title: "Meerdaags Festival", officialUrl: festival }),
      discoveredCandidate({ title: "Clubavond", startDate: "2027-09-16", endDate: null, officialUrl: clubNight }),
    ]);
    create.mockResolvedValue(verificationResponse(festival, []));

    const triage = vi.fn().mockResolvedValue(
      new Map([[1, "Eenmalige clubavond zonder bovenregionale toestroom."]]),
    );
    const result = await collectClaude({
      ...claudeWindow,
      location: "Eindhoven",
      radiusKm: 25,
      model: "claude-test",
      client: { messages: { create } } as unknown as Anthropic,
      triage,
    });

    expect(triage).toHaveBeenCalledWith([
      expect.objectContaining({ title: "Meerdaags Festival" }),
      expect.objectContaining({ title: "Clubavond" }),
    ]);
    expect(create).toHaveBeenCalledTimes(13);
    expect(create.mock.calls[12][0].messages[0].content).toContain(festival);
    expect(result.funnel?.namesDiscovered).toBe(2);
    expect(result.funnel?.drops).toContainEqual({
      title: "Clubavond",
      stage: "triage",
      reason: "Eenmalige clubavond zonder bovenregionale toestroom.",
    });
  });
  it("never puts a multi-day candidate through metadata triage", async () => {
    const create = vi.fn();
    queueClaudeSearches(create, [
      discoveredCandidate({
        title: "Revolution Calling",
        startDate: "2027-09-20",
        endDate: "2027-09-21",
        officialUrl: "https://venue.nl/revolution-calling",
      }),
      discoveredCandidate({
        title: "Marillion",
        startDate: "2027-09-16",
        endDate: null,
        officialUrl: "https://venue.nl/marillion",
      }),
    ]);
    create.mockResolvedValue(verificationResponse("https://venue.nl/revolution-calling", []));

    await collectClaude({
      ...claudeWindow,
      location: "Eindhoven",
      radiusKm: 25,
      model: "claude-test",
      client: { messages: { create } } as unknown as Anthropic,
    });

    const triageRequest = create.mock.calls
      .map(([request]) => request.messages[0].content as string)
      .find((content) => content.includes("welke kandidaten een webcontrole waard zijn"));
    expect(triageRequest).toBeDefined();
    expect(triageRequest).toContain("Marillion");
    expect(triageRequest).not.toContain("Revolution Calling");
  });



  it("keeps collecting when one discovery search fails", async () => {
    const official = "https://organizer.nl/event";
    const create = vi.fn();
    create.mockRejectedValueOnce(new Error("Claude search returned 500."));
    create.mockResolvedValueOnce(
      discoveryResponse([discoveredCandidate({ officialUrl: official })]),
    );
    for (let index = 2; index < 12; index += 1) {
      create.mockResolvedValueOnce(discoveryResponse());
    }
    create.mockResolvedValueOnce(
      verificationResponse(official, [verifiedEvent({ sourceUrl: official })]),
    );

    const result = await collectClaude({
      ...claudeWindow,
      location: "Eindhoven",
      radiusKm: 25,
      model: "claude-test",
      client: { messages: { create } } as unknown as Anthropic,
      triage: async () => new Map<number, string>(),
    });

    expect(result.requests).toBe(12);
    expect(result.candidates).toHaveLength(1);
    expect(result.funnel?.drops).toEqual([
      {
        title: "<stadsbrede festivals, design weeks en marathons 2027-08-01>",
        stage: "discovery",
        reason: "Claude search returned 500.",
      },
    ]);
  });

  it("runs discovery on the configured discovery model and verification on the main model", async () => {
    const agendaUrl = "https://uitagenda.example/september";
    const official = "https://organizer.nl/event";
    const create = vi.fn();
    queueClaudeSearches(create, [], [agendaUrl]);
    create.mockResolvedValueOnce(
      agendaResponse(agendaUrl, [discoveredCandidate({ officialUrl: official })]),
    );
    create.mockResolvedValueOnce(
      verificationResponse(official, [verifiedEvent({ sourceUrl: official })]),
    );

    await collectClaude({
      ...claudeWindow,
      location: "Eindhoven",
      radiusKm: 25,
      model: "claude-test",
      discoveryModel: "claude-haiku-test",
      client: { messages: { create } } as unknown as Anthropic,
      triage: async () => new Map<number, string>(),
    });

    create.mock.calls.slice(0, 13).forEach(([request]) => {
      expect(request.model).toBe("claude-haiku-test");
    });
    expect(create.mock.calls[13][0].model).toBe("claude-test");
  });

  it("refreshes a known owner page and preserves its cancelled status", async () => {
    const knownUrl = "https://venue.nl/known-event";
    const create = vi.fn();
    queueClaudeSearches(create);
    create.mockResolvedValueOnce(
      verificationResponse(knownUrl, [
        verifiedEvent({
          sourceUrl: knownUrl,
          title: "Cancelled conference",
          category: "conferences",
          venue: "Venue",
          status: "cancelled",
          ownerType: "venue",
          evidenceText: "Official cancellation notice.",
          impactPoints: 45,
        }),
      ]),
    );

    const result = await collectClaude({
      ...claudeWindow,
      location: "Eindhoven",
      radiusKm: 25,
      knownUrls: [knownUrl],
      model: "claude-test",
      client: { messages: { create } } as unknown as Anthropic,
      triage: async () => new Map<number, string>(),
    });

    expect(create.mock.calls[12][0].messages[0].content).toContain(knownUrl);
    expect(result.candidates[0]).toMatchObject({
      provider: "claude",
      sourceState: "cancelled",
    });
  });

  it("keeps successful page evidence when another Claude fetch fails", async () => {
    const urls = ["https://venue.nl/broken", "https://organizer.nl/event"];
    const create = vi.fn();
    queueClaudeSearches(create, [
      discoveredCandidate({ title: "Kapotte pagina", officialUrl: urls[0] }),
      discoveredCandidate({ title: "International conference", officialUrl: urls[1] }),
    ]);
    create.mockResolvedValueOnce({
      stop_reason: "max_tokens",
      content: [{ type: "thinking", thinking: "" }],
      usage: {
        input_tokens: 500,
        output_tokens: 2_000,
        server_tool_use: { web_fetch_requests: 1 },
      },
    });
    create.mockResolvedValueOnce(
      verificationResponse(urls[1], [
        verifiedEvent({
          sourceUrl: urls[1],
          title: "International conference",
          category: "conferences",
          venue: "Conference Centre",
          impactPoints: 45,
        }),
      ]),
    );

    const result = await collectClaude({
      ...claudeWindow,
      location: "Eindhoven",
      radiusKm: 25,
      model: "claude-test",
      client: { messages: { create } } as unknown as Anthropic,
      triage: async () => new Map<number, string>(),
    });

    expect(result.requests).toBe(14);
    expect(result.candidates).toHaveLength(1);
    expect(result.usage.failedFetches).toBe(1);
    expect(result.funnel?.drops).toEqual([
      { title: "Kapotte pagina", stage: "verification", reason: "Tokenlimiet bereikt." },
    ]);
  });

  it("identifies a Claude search timeout", async () => {
    const create = vi.fn().mockRejectedValue(new APIConnectionTimeoutError());
    const client = { messages: { create } } as unknown as Anthropic;

    await expect(
      collectClaude({
        ...claudeWindow,
        location: "Eindhoven",
        radiusKm: 25,
        model: "claude-test",
        client,
        triage: async () => new Map<number, string>(),
      })
    ).rejects.toThrow("Claude search timed out.");
  });

  it("identifies a Claude verification timeout", async () => {
    const create = vi.fn();
    queueClaudeSearches(create, [
      discoveredCandidate({ officialUrl: "https://venue.nl/event" }),
    ]);
    create.mockRejectedValueOnce(new APIConnectionTimeoutError());
    const client = { messages: { create } } as unknown as Anthropic;

    await expect(
      collectClaude({
        ...claudeWindow,
        location: "Eindhoven",
        radiusKm: 25,
        model: "claude-test",
        client,
        triage: async () => new Map<number, string>(),
      })
    ).rejects.toThrow("Claude verification timed out.");
  });

  it("identifies a Claude verification token limit", async () => {
    const create = vi.fn();
    queueClaudeSearches(create, [
      discoveredCandidate({ officialUrl: "https://venue.nl/event" }),
    ]);
    create.mockResolvedValueOnce({
      stop_reason: "max_tokens",
      content: [{ type: "thinking", thinking: "" }],
      usage: {
        input_tokens: 1000,
        output_tokens: 12_000,
        server_tool_use: { web_fetch_requests: 1 },
      },
    });
    const client = { messages: { create } } as unknown as Anthropic;

    await expect(
      collectClaude({
        ...claudeWindow,
        location: "Eindhoven",
        radiusKm: 25,
        model: "claude-test",
        client,
        triage: async () => new Map<number, string>(),
      })
    ).rejects.toThrow("Claude verification reached its token limit.");
  });

  it("triages PredictHQ metadata in batches without web tools", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            reviews: [
              {
                providerEventId: "phq-1",
                decision: "verify",
                confidence: "high",
                demandLevel: "high",
                evidenceText: "Grote meerdaagse beurs.",
              },
            ],
          }),
        },
      ],
      usage: { input_tokens: 300, output_tokens: 80 },
    });
    const client = { messages: { create } } as unknown as Anthropic;
    const onUsage = vi.fn();
    const candidate = (
      await collectPredictHq({
        ...window,
        latitude: 51.44,
        longitude: 5.48,
        radiusKm: 30,
        accessToken: "test",
        fetcher: vi.fn().mockResolvedValue(jsonResponse(predictHqFixture)),
      })
    ).candidates[0];

    const result = await triagePredictHqCandidates({
      candidates: [candidate],
      hotelName: "Testhotel",
      location: "Eindhoven",
      radiusKm: 25,
      model: "claude-test",
      client,
      onUsage,
    });

    expect(result.reviews).toEqual([
      expect.objectContaining({ providerEventId: "phq-1", decision: "verify" }),
    ]);
    expect(create.mock.calls[0][0].tools).toBeUndefined();
    expect(create.mock.calls[0][0].output_config).toEqual({
      format: expect.objectContaining({ type: "json_schema" }),
    });
    expect(create.mock.calls[0][0].messages[0].content).toContain(
      "geen aannames over feitelijke bevestiging"
    );
    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "demand_triage",
        model: "claude-test",
        inputTokens: 300,
      })
    );
  });

  it("never sends predicted events from metadata triage to web verification", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            reviews: [
              {
                providerEventId: "phq-predicted",
                decision: "verify",
                confidence: "high",
                demandLevel: "peak",
                evidenceText: "Groot verwacht evenement.",
              },
            ],
          }),
        },
      ],
      usage: { input_tokens: 100, output_tokens: 30 },
    });
    const client = { messages: { create } } as unknown as Anthropic;
    const predicted = {
      ...(
        await collectPredictHq({
          ...window,
          latitude: 51.44,
          longitude: 5.48,
          radiusKm: 30,
          accessToken: "test",
          fetcher: vi.fn().mockResolvedValue(jsonResponse(predictHqFixture)),
        })
      ).candidates[1],
      providerEventId: "phq-predicted",
    };

    const result = await triagePredictHqCandidates({
      candidates: [predicted],
      hotelName: "Testhotel",
      location: "Eindhoven",
      radiusKm: 25,
      model: "claude-test",
      client,
    });

    expect(result.reviews[0]).toMatchObject({
      decision: "provisional",
      demandLevel: "peak",
    });
  });

  it("keeps a PredictHQ candidate only with cited primary evidence", async () => {
    const sourceUrl = "https://organizer.nl/major-trade-fair";
    const create = vi.fn().mockResolvedValue({
      content: [
        {
          type: "web_search_tool_result",
          content: [{ type: "web_search_result", url: sourceUrl }],
        },
        {
          type: "text",
          text: JSON.stringify({
            providerEventId: "phq-1",
            decision: "verified",
            confidence: "high",
            sourceUrl,
            ownerType: "organizer",
            evidenceText: "Meerdaagse vakbeurs met landelijke bezoekers.",
            titleConfirmed: true,
            dateConfirmed: true,
            locationConfirmed: true,
          }),
        },
      ],
      usage: {
        input_tokens: 300,
        output_tokens: 80,
        server_tool_use: { web_search_requests: 1, web_fetch_requests: 1 },
      },
    });
    const client = { messages: { create } } as unknown as Anthropic;
    const candidate = (
      await collectPredictHq({
        ...window,
        latitude: 51.44,
        longitude: 5.48,
        radiusKm: 30,
        accessToken: "test",
        fetcher: vi.fn().mockResolvedValue(jsonResponse(predictHqFixture)),
      })
    ).candidates[0];

    const result = await verifyPredictHqCandidates({
      candidates: [candidate],
      hotelName: "Testhotel",
      location: "Eindhoven",
      radiusKm: 25,
      model: "claude-sonnet-5",
      client,
    });

    expect(result.reviews).toEqual([
      expect.objectContaining({
        providerEventId: "phq-1",
        decision: "verified",
        sourceUrl,
      }),
    ]);
    expect(create.mock.calls[0][0].messages[0].content).toContain(
      "maximaal één openbare primaire bron"
    );
    expect(create.mock.calls[0][0].tools).toHaveLength(1);
    expect(create.mock.calls[0][0].output_config).toEqual({
      format: expect.objectContaining({ type: "json_schema" }),
    });
    expect(create.mock.calls[0][0].tools[0].max_uses).toBe(1);
    expect(create.mock.calls[0][0].thinking).toEqual({ type: "disabled" });
  });

  it("gives events on the same source page separate stable IDs", () => {
    const first = claudeProviderEventId({
      sourceUrl: "https://venue.nl/agenda",
      title: "Event A",
      startAt: "2027-09-01T10:00:00+02:00",
      venue: "Venue",
    });
    const second = claudeProviderEventId({
      sourceUrl: "https://venue.nl/agenda",
      title: "Event B",
      startAt: "2027-09-02T10:00:00+02:00",
      venue: "Venue",
    });
    expect(first).not.toBe(second);
    expect(first).toBe(
      claudeProviderEventId({
        sourceUrl: "https://venue.nl/agenda",
        title: "Event A",
        startAt: "2027-09-01T19:00:00+02:00",
        venue: "Venue",
      })
    );
  });

  it("uses the only observed primary URL when structured output omits it", async () => {
    const sourceUrl = "https://organizer.nl/major-trade-fair";
    const create = vi.fn().mockResolvedValue({
      content: [
        {
          type: "web_search_tool_result",
          content: [{ type: "web_search_result", url: sourceUrl }],
        },
        {
          type: "text",
          text: JSON.stringify({
            providerEventId: "phq-1",
            decision: "verified",
            confidence: "high",
            sourceUrl: null,
            ownerType: "organizer",
            evidenceText: "Officiële organisator bevestigt het evenement.",
            titleConfirmed: true,
            dateConfirmed: true,
            locationConfirmed: true,
          }),
        },
      ],
      usage: {
        input_tokens: 100,
        output_tokens: 40,
        server_tool_use: { web_search_requests: 1 },
      },
    });
    const client = { messages: { create } } as unknown as Anthropic;
    const candidate = (
      await collectPredictHq({
        ...window,
        latitude: 51.44,
        longitude: 5.48,
        radiusKm: 30,
        accessToken: "test",
        fetcher: vi.fn().mockResolvedValue(jsonResponse(predictHqFixture)),
      })
    ).candidates[0];

    const result = await verifyPredictHqCandidates({
      candidates: [candidate],
      hotelName: "Testhotel",
      location: "Eindhoven",
      radiusKm: 25,
      model: "claude-test",
      client,
    });

    expect(result.reviews[0]).toMatchObject({
      decision: "verified",
      sourceUrl,
    });
  });

  it("rejects a claimed primary URL that Claude did not cite", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            providerEventId: "phq-1",
            decision: "verified",
            confidence: "high",
            sourceUrl: "https://invented.example/event",
            ownerType: "organizer",
            evidenceText: "Claim",
            titleConfirmed: true,
            dateConfirmed: true,
            locationConfirmed: true,
          }),
        },
      ],
      usage: {
        input_tokens: 100,
        output_tokens: 40,
        server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 },
      },
    });
    const client = { messages: { create } } as unknown as Anthropic;
    const candidate = (
      await collectPredictHq({
        ...window,
        latitude: 51.44,
        longitude: 5.48,
        radiusKm: 30,
        accessToken: "test",
        fetcher: vi.fn().mockResolvedValue(jsonResponse(predictHqFixture)),
      })
    ).candidates[0];

    const result = await verifyPredictHqCandidates({
      candidates: [candidate],
      hotelName: "Testhotel",
      location: "Eindhoven",
      radiusKm: 25,
      model: "claude-test",
      client,
    });

    expect(result.reviews).toEqual([
      expect.objectContaining({
        providerEventId: "phq-1",
        decision: "unverifiable",
        sourceUrl: null,
      }),
    ]);
  });

  it("never treats an authenticated PredictHQ API URL as public evidence", async () => {
    const apiUrl = "https://api.predicthq.com/v1/events/phq-1/";
    const create = vi.fn().mockResolvedValue({
      content: [
        {
          type: "web_search_tool_result",
          content: [{ type: "web_search_result", url: apiUrl }],
        },
        {
          type: "text",
          text: JSON.stringify({
            providerEventId: "phq-1",
            decision: "verified",
            confidence: "high",
            sourceUrl: apiUrl,
            ownerType: "other",
            evidenceText: apiUrl,
            titleConfirmed: true,
            dateConfirmed: true,
            locationConfirmed: true,
          }),
        },
      ],
      usage: {
        input_tokens: 50,
        output_tokens: 20,
        server_tool_use: { web_search_requests: 1 },
      },
    });
    const candidate = (
      await collectPredictHq({
        ...window,
        latitude: 51.44,
        longitude: 5.48,
        radiusKm: 30,
        accessToken: "test",
        fetcher: vi.fn().mockResolvedValue(jsonResponse(predictHqFixture)),
      })
    ).candidates[0];

    const result = await verifyPredictHqCandidates({
      candidates: [candidate],
      hotelName: "Testhotel",
      location: "Eindhoven",
      radiusKm: 25,
      model: "claude-test",
      client: { messages: { create } } as unknown as Anthropic,
    });

    expect(result.reviews[0]).toMatchObject({
      decision: "unverifiable",
      sourceUrl: null,
    });
  });
});
