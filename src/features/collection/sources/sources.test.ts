import { describe, expect, it, vi } from "vitest";
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
import { collectUefaForecasts } from "./uefa";

const jsonResponse = (value: unknown) =>
  new Response(JSON.stringify(value), { status: 200 });
const window = { start: "2027-01-01", end: "2027-12-31" };

describe("source adapters", () => {
  it("creates zero-cost provisional UEFA matchweek windows", () => {
    const result = collectUefaForecasts({
      start: "2026-09-01",
      end: "2026-09-30",
    });
    expect(result.requests).toBe(0);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0]).toMatchObject({
      provider: "uefa",
      sourceState: "predicted",
      certainty: "provisional",
      venue: "Philips Stadion",
    });
  });

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

  it("verifies Claude discoveries against fetched owner pages", async () => {
    const urls = Array.from(
      { length: 9 },
      (_, index) => `https://venue.nl/event-${index + 1}`
    );
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: "web_search_tool_result",
            content: urls.map((url) => ({ type: "web_search_result", url })),
          },
        ],
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          server_tool_use: { web_search_requests: 1 },
        },
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              events: [
                {
                  sourceUrl: "https://venue.nl/event",
                  title: "Design festival",
                  category: "festival",
                  venue: "Venue",
                  latitude: 51.44,
                  longitude: 5.48,
                  regionScope: null,
                  startAt: "2027-09-01T10:00:00+02:00",
                  endAt: "2027-09-02T22:00:00+02:00",
                  ownerType: "venue",
                  evidenceText: "Official event page",
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
          input_tokens: 200,
          output_tokens: 80,
          server_tool_use: { web_fetch_requests: 1 },
        },
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: JSON.stringify({ events: [] }) }],
        usage: {
          input_tokens: 150,
          output_tokens: 20,
          server_tool_use: { web_fetch_requests: 1 },
        },
      });

    const client = { messages: { create } } as unknown as Anthropic;
    const result = await collectClaude({
      ...window,
      location: "Eindhoven",
      radiusKm: 25,
      model: "claude-test",
      client,
    });
    const searchRequest = create.mock.calls[0][0];
    const firstVerificationRequest = create.mock.calls[1][0];
    const secondVerificationRequest = create.mock.calls[2][0];
    expect(searchRequest.tools[0]).toMatchObject({
      allowed_callers: ["direct"],
      max_uses: 2,
      response_inclusion: "full",
    });
    expect(searchRequest.messages[0].content).toContain("25 km");
    expect(searchRequest.messages[0].content).toContain(
      "feestdagen en schoolvakanties"
    );
    expect(create.mock.calls[0][1]).toEqual({
      timeout: 120_000,
      maxRetries: 0,
    });
    expect(create.mock.calls[1][1]).toEqual({
      timeout: 180_000,
      maxRetries: 0,
    });
    expect(create.mock.calls[2][1]).toEqual({
      timeout: 180_000,
      maxRetries: 0,
    });
    expect(firstVerificationRequest.max_tokens).toBe(4_000);
    expect(firstVerificationRequest.tools[0]).toEqual({
      type: "web_fetch_20250910",
      name: "web_fetch",
      max_uses: 4,
      max_content_tokens: 2_000,
      citations: { enabled: false },
    });
    expect(firstVerificationRequest.messages[0].content).toContain(urls[3]);
    expect(firstVerificationRequest.messages[0].content).not.toContain(urls[4]);
    expect(secondVerificationRequest.messages[0].content).toContain(urls[7]);
    expect(secondVerificationRequest.messages[0].content).not.toContain(
      urls[8]
    );
    expect(result.requests).toBe(3);
    expect(result.candidates[0]).toMatchObject({
      sourceUrl: "https://venue.nl/event",
      primarySourceConfirmed: true,
      aiImpactPoints: 45,
    });
  });

  it("identifies a Claude search timeout", async () => {
    const create = vi.fn().mockRejectedValue(new APIConnectionTimeoutError());
    const client = { messages: { create } } as unknown as Anthropic;

    await expect(
      collectClaude({
        ...window,
        location: "Eindhoven",
        radiusKm: 25,
        model: "claude-test",
        client,
      })
    ).rejects.toThrow("Claude search timed out.");
  });

  it("identifies a Claude verification timeout", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: "web_search_tool_result",
            content: [
              { type: "web_search_result", url: "https://venue.nl/event" },
            ],
          },
        ],
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          server_tool_use: { web_search_requests: 1 },
        },
      })
      .mockRejectedValueOnce(new APIConnectionTimeoutError());
    const client = { messages: { create } } as unknown as Anthropic;

    await expect(
      collectClaude({
        ...window,
        location: "Eindhoven",
        radiusKm: 25,
        model: "claude-test",
        client,
      })
    ).rejects.toThrow("Claude verification timed out.");
  });

  it("identifies a Claude verification token limit", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: "web_search_tool_result",
            content: [
              { type: "web_search_result", url: "https://venue.nl/event" },
            ],
          },
        ],
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          server_tool_use: { web_search_requests: 1 },
        },
      })
      .mockResolvedValueOnce({
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
        ...window,
        location: "Eindhoven",
        radiusKm: 25,
        model: "claude-test",
        client,
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
