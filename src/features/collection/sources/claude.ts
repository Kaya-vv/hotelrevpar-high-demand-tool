import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import type { CollectionWindow, SourceResult } from "../types";

const ownerTypes = ["organizer", "venue", "club", "university", "municipality", "event_owner"] as const;
const requestOptions = { timeout: 60_000, maxRetries: 0 } as const;
const outputSchema = z.object({
  events: z.array(
    z.object({
      sourceUrl: z.url(),
      title: z.string(),
      category: z.string(),
      venue: z.string().nullable(),
      latitude: z.number().nullable(),
      longitude: z.number().nullable(),
      regionScope: z.string().nullable(),
      startAt: z.string(),
      endAt: z.string(),
      ownerType: z.string(),
      evidenceText: z.string().nullable(),
      titleConfirmed: z.boolean(),
      dateConfirmed: z.boolean(),
      locationConfirmed: z.boolean(),
    }),
  ),
});

const outputJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          sourceUrl: { type: "string", format: "uri" }, title: { type: "string" }, category: { type: "string" },
          venue: { type: ["string", "null"] }, latitude: { type: ["number", "null"] }, longitude: { type: ["number", "null"] },
          regionScope: { type: ["string", "null"] }, startAt: { type: "string" }, endAt: { type: "string" },
          ownerType: { type: "string" }, evidenceText: { type: ["string", "null"] }, titleConfirmed: { type: "boolean" },
          dateConfirmed: { type: "boolean" }, locationConfirmed: { type: "boolean" },
        },
        required: ["sourceUrl", "title", "category", "venue", "latitude", "longitude", "regionScope", "startAt", "endAt", "ownerType", "evidenceText", "titleConfirmed", "dateConfirmed", "locationConfirmed"],
      },
    },
  },
  required: ["events"],
} as const;

function sourceUrls(message: Anthropic.Message) {
  const urls = new Set<string>();
  message.content.forEach((block) => {
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      block.content.forEach((result) => urls.add(result.url));
    }
    if (block.type === "text") {
      block.citations?.forEach((citation) => {
        if (citation.type === "web_search_result_location") urls.add(citation.url);
      });
    }
  });
  return [...urls];
}

export async function collectClaude(
  input: CollectionWindow & { location: string; model?: string; client?: Anthropic },
): Promise<SourceResult> {
  const model = input.model ?? process.env.ANTHROPIC_MODEL;
  if (!model) throw new Error("ANTHROPIC_MODEL is required for the Claude source.");
  const client = input.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const search = await client.messages.create({
    model,
    max_tokens: 1200,
    tools: [{
      type: "web_search_20260318",
      name: "web_search",
      allowed_callers: ["direct"],
      max_uses: 2,
      response_inclusion: "full",
      user_location: { type: "approximate", country: "NL", city: input.location, timezone: "Europe/Amsterdam" },
    }],
    messages: [{
      role: "user",
      content: `Vind geplande evenementen in of rond ${input.location} tussen ${input.start} en ${input.end} die hotelvraag kunnen verhogen. Geef voorrang aan organisatoren, locaties, clubs, universiteiten en gemeenten.`,
    }],
  }, requestOptions);
  const urls = sourceUrls(search).slice(0, 8);
  if (!urls.length) {
    return {
      source: "claude",
      candidates: [],
      requests: 1,
      usage: { inputTokens: search.usage.input_tokens, outputTokens: search.usage.output_tokens },
    };
  }

  const verified = await client.messages.create({
    model,
    max_tokens: 2400,
    tools: [{
      type: "web_fetch_20260318",
      name: "web_fetch",
      max_uses: urls.length,
      max_content_tokens: 12_000,
      citations: { enabled: false },
    }],
    output_config: { format: { type: "json_schema", schema: outputJsonSchema } },
    messages: [{
      role: "user",
      content: `Open deze pagina's en controleer per evenement titel, datum en locatie. Neem alleen evenementen in het venster op. Pagina's:\n${urls.join("\n")}`,
    }],
  }, requestOptions);
  const text = verified.content.find((block) => block.type === "text")?.text;
  if (!text) throw new Error("Claude verification returned no structured output.");
  const parsed = outputSchema.parse(JSON.parse(text));
  const candidates = parsed.events.map((event) => ({
    provider: "claude" as const,
    providerEventId: event.sourceUrl,
    sourceUrl: event.sourceUrl,
    title: event.title,
    category: event.category,
    venue: event.venue,
    latitude: event.latitude,
    longitude: event.longitude,
    regionScope: event.regionScope,
    startAt: event.startAt,
    endAt: event.endAt,
    sourceState: "active" as const,
    certainty: "confirmed" as const,
    localRank: null,
    attendance: null,
    venueCapacity: null,
    evidenceText: event.evidenceText,
    primarySourceConfirmed:
      ownerTypes.includes(event.ownerType as (typeof ownerTypes)[number]) &&
      event.titleConfirmed &&
      event.dateConfirmed &&
      event.locationConfirmed,
  }));

  return {
    source: "claude",
    candidates,
    requests: 2,
    usage: {
      inputTokens: search.usage.input_tokens + verified.usage.input_tokens,
      outputTokens: search.usage.output_tokens + verified.usage.output_tokens,
      webSearchRequests: search.usage.server_tool_use?.web_search_requests ?? 0,
    },
  };
}

