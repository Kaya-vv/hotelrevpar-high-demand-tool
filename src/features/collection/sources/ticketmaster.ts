import { z } from "zod";

import { fetchJson } from "../http";
import type { CollectionWindow, Fetcher, SourceResult } from "../types";

const venueSchema = z.object({
  name: z.string().optional(),
  location: z.object({ latitude: z.string(), longitude: z.string() }).optional(),
  city: z.object({ name: z.string() }).optional(),
});
const responseSchema = z.object({
  _embedded: z.object({
    events: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        url: z.url(),
        dates: z.object({
          start: z.object({ dateTime: z.string().optional(), localDate: z.string().optional(), localTime: z.string().optional() }),
          end: z.object({ dateTime: z.string().optional(), localDate: z.string().optional(), localTime: z.string().optional() }).optional(),
          status: z.object({ code: z.string() }),
        }),
        classifications: z.array(z.object({ segment: z.object({ name: z.string() }).optional() })).optional(),
        _embedded: z.object({ venues: z.array(venueSchema) }).optional(),
      }),
    ),
  }).default({ events: [] }),
  page: z.object({ number: z.number(), totalPages: z.number(), totalElements: z.number() }),
});

function dateTime(value: { dateTime?: string; localDate?: string; localTime?: string }) {
  return value.dateTime ?? `${value.localDate}T${value.localTime ?? "00:00:00"}`;
}

function state(code: string) {
  if (code === "cancelled") return "cancelled" as const;
  if (code === "postponed" || code === "rescheduled") return "postponed" as const;
  return "active" as const;
}

export async function collectTicketmaster(
  input: CollectionWindow & { city: string; latitude: number; longitude: number; radiusKm: number; apiKey: string; fetcher?: Fetcher },
): Promise<SourceResult> {
  const candidates: SourceResult["candidates"] = [];
  let requests = 0;

  for (let page = 0; page < 5; page += 1) {
    const url = new URL("https://app.ticketmaster.com/discovery/v2/events.json");
    url.search = new URLSearchParams({
      apikey: input.apiKey,
      latlong: `${input.latitude},${input.longitude}`,
      radius: String(input.radiusKm),
      unit: "km",
      countryCode: "NL",
      startDateTime: `${input.start}T00:00:00Z`,
      endDateTime: `${input.end}T23:59:59Z`,
      size: "200",
      page: String(page),
      sort: "date,asc",
    }).toString();
    const response = await fetchJson(url, responseSchema, input.fetcher);
    requests += 1;

    response._embedded.events.forEach((event) => {
      const venue = event._embedded?.venues[0];
      const startAt = dateTime(event.dates.start);
      candidates.push({
        provider: "ticketmaster",
        providerEventId: event.id,
        sourceUrl: event.url,
        title: event.name,
        category: event.classifications?.[0]?.segment?.name.toLowerCase().replace(/[^a-z0-9]+/g, "_") ?? "event",
        venue: venue?.name ?? null,
        latitude: venue?.location ? Number(venue.location.latitude) : null,
        longitude: venue?.location ? Number(venue.location.longitude) : null,
        regionScope: venue?.city?.name ?? input.city,
        startAt,
        endAt: event.dates.end ? dateTime(event.dates.end) : startAt,
        sourceState: state(event.dates.status.code),
        certainty: "confirmed",
        localRank: null,
        attendance: null,
        venueCapacity: null,
        evidenceText: null,
        primarySourceConfirmed: true,
      });
    });

    if (page + 1 >= response.page.totalPages) break;
  }

  return { source: "ticketmaster", candidates, requests, usage: {} };
}

