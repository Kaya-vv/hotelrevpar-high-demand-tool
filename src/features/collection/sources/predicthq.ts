import { z } from "zod";

import { fetchJson } from "../http";
import type { CollectionWindow, Fetcher, SourceResult } from "../types";

const responseSchema = z.object({
  next: z.url().nullable(),
  results: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      category: z.string(),
      start: z.string(),
      end: z.string().nullable().optional(),
      predicted_end: z.string().nullable().optional(),
      state: z.enum(["active", "predicted", "deleted"]),
      local_rank: z.number().nullable(),
      phq_attendance: z.number().nullable(),
      location: z.tuple([z.number(), z.number()]),
    }),
  ),
});

export async function collectPredictHq(
  input: CollectionWindow & {
    latitude: number;
    longitude: number;
    radiusKm: number;
    accessToken: string;
    fetcher?: Fetcher;
  },
): Promise<SourceResult> {
  const candidates: SourceResult["candidates"] = [];
  let requests = 0;
  let next: string | null = "https://api.predicthq.com/v1/events/";

  while (next) {
    const url: URL = new URL(next);
    if (requests === 0) {
      url.search = new URLSearchParams({
        within: `${input.radiusKm}km@${input.latitude},${input.longitude}`,
        "start.gte": input.start,
        "start.lte": input.end,
        state: "active,predicted,deleted",
        category: "concerts,conferences,expos,festivals,performing-arts,sports,community",
        limit: "500",
      }).toString();
    }
    const response: z.infer<typeof responseSchema> = await fetchJson(url, responseSchema, input.fetcher, {
      headers: { Authorization: `Bearer ${input.accessToken}`, Accept: "application/json" },
    });
    requests += 1;
    response.results.forEach((event) => {
      candidates.push({
        provider: "predicthq",
        providerEventId: event.id,
        sourceUrl: `https://api.predicthq.com/v1/events/${event.id}/`,
        title: event.title,
        category: event.category,
        venue: null,
        latitude: event.location[1],
        longitude: event.location[0],
        regionScope: null,
        startAt: event.start,
        endAt: event.end ?? event.predicted_end ?? event.start,
        sourceState: event.state === "deleted" ? "cancelled" : event.state,
        certainty: event.state === "predicted" ? "provisional" : "confirmed",
        localRank: event.local_rank,
        attendance: event.phq_attendance,
        venueCapacity: null,
        evidenceText: null,
        primarySourceConfirmed: true,
      });
    });
    next = response.next;
  }

  return { source: "predicthq", candidates, requests, usage: {} };
}
