import { describe, expect, it, vi } from "vitest";
import { APIConnectionTimeoutError, type default as Anthropic } from "@anthropic-ai/sdk";

import openHolidaysFixture from "../../../../tests/fixtures/openholidays.json";
import predictHqFixture from "../../../../tests/fixtures/predicthq.json";
import rijksoverheidFixture from "../../../../tests/fixtures/rijksoverheid.json";
import ticketmasterFixture from "../../../../tests/fixtures/ticketmaster.json";
import { collectClaude } from "./claude";
import { collectOpenHolidays } from "./openholidays";
import { collectPredictHq } from "./predicthq";
import { collectRijksoverheid } from "./rijksoverheid";
import { collectTicketmaster } from "./ticketmaster";

const jsonResponse = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
const window = { start: "2027-01-01", end: "2027-12-31" };

describe("source adapters", () => {
  it("maps school holidays from Rijksoverheid", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(rijksoverheidFixture));
    const result = await collectRijksoverheid({ ...window, fetcher });
    expect(result.requests).toBe(1);
    expect(result.candidates).toMatchObject([{ category: "school_holiday", regionScope: "south" }]);
  });

  it("maps Dutch public holidays in the window", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(openHolidaysFixture));
    const result = await collectOpenHolidays({ ...window, fetcher });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ title: "Nieuwjaarsdag", category: "public_holiday" });
  });

  it("maps Ticketmaster status and stops at the last page", async () => {
    const secondPage = { _embedded: { events: [] }, page: { number: 1, totalPages: 2, totalElements: 2 } };
    const fetcher = vi.fn().mockResolvedValueOnce(jsonResponse(ticketmasterFixture)).mockResolvedValueOnce(jsonResponse(secondPage));
    const result = await collectTicketmaster({ ...window, city: "Eindhoven", apiKey: "test", fetcher });
    expect(result.requests).toBe(2);
    expect(result.candidates.map((event) => event.sourceState)).toEqual(["active", "cancelled"]);
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
    expect(result.candidates[1]).toMatchObject({ sourceState: "predicted", certainty: "provisional", localRank: 60 });
  });

  it("verifies Claude discoveries against fetched owner pages", async () => {
    const urls = Array.from({ length: 9 }, (_, index) => `https://venue.nl/event-${index + 1}`);
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        content: [{ type: "web_search_tool_result", content: urls.map((url) => ({ type: "web_search_result", url })) }],
        usage: { input_tokens: 100, output_tokens: 20, server_tool_use: { web_search_requests: 1 } },
      })
      .mockResolvedValueOnce({
        content: [{
          type: "text",
          text: JSON.stringify({ events: [{
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
            titleConfirmed: true,
            dateConfirmed: true,
            locationConfirmed: true
          }] }),
        }],
        usage: { input_tokens: 200, output_tokens: 80, server_tool_use: { web_fetch_requests: 1 } },
      });

    const client = { messages: { create } } as unknown as Anthropic;
    const result = await collectClaude({ ...window, location: "Eindhoven", model: "claude-test", client });
    const searchRequest = create.mock.calls[0][0];
    const verificationRequest = create.mock.calls[1][0];
    expect(searchRequest.tools[0]).toMatchObject({
      allowed_callers: ["direct"],
      max_uses: 2,
      response_inclusion: "full",
    });
    expect(create.mock.calls[0][1]).toEqual({ timeout: 120_000, maxRetries: 0 });
    expect(create.mock.calls[1][1]).toEqual({ timeout: 120_000, maxRetries: 0 });
    expect(verificationRequest.tools[0]).toMatchObject({ max_uses: 8 });
    expect(verificationRequest.messages[0].content).toContain(urls[7]);
    expect(verificationRequest.messages[0].content).not.toContain(urls[8]);
    expect(result.requests).toBe(2);
    expect(result.candidates[0]).toMatchObject({ sourceUrl: "https://venue.nl/event", primarySourceConfirmed: true });
  });

  it("identifies a Claude search timeout", async () => {
    const create = vi.fn().mockRejectedValue(new APIConnectionTimeoutError());
    const client = { messages: { create } } as unknown as Anthropic;

    await expect(collectClaude({ ...window, location: "Eindhoven", model: "claude-test", client }))
      .rejects.toThrow("Claude search timed out.");
  });

  it("identifies a Claude verification timeout", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        content: [{ type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://venue.nl/event" }] }],
        usage: { input_tokens: 100, output_tokens: 20, server_tool_use: { web_search_requests: 1 } },
      })
      .mockRejectedValueOnce(new APIConnectionTimeoutError());
    const client = { messages: { create } } as unknown as Anthropic;

    await expect(collectClaude({ ...window, location: "Eindhoven", model: "claude-test", client }))
      .rejects.toThrow("Claude verification timed out.");
  });
});
