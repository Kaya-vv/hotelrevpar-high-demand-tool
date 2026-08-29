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
      deleted_reason: z.string().nullable().optional(),
      cancelled: z.string().nullable().optional(),
      postponed: z.string().nullable().optional(),
      duplicate_of_id: z.string().nullable().optional(),
      local_rank: z.number().nullable().optional(),
      phq_attendance: z.number().nullable().optional(),
      location: z.tuple([z.number(), z.number()]),
      entities: z
        .array(z.object({ name: z.string(), type: z.string() }))
        .nullable()
        .optional(),
    })
  ),
});

export async function collectPredictHq(
  input: CollectionWindow & {
    latitude: number;
    longitude: number;
    radiusKm: number;
    accessToken: string;
    fetcher?: Fetcher;
  }
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
        category:
          "concerts,conferences,expos,festivals,performing-arts,sports,community",
        limit: "500",
      }).toString();
    }
    const response: z.infer<typeof responseSchema> = await fetchJson(
      url,
      responseSchema,
      input.fetcher,
      {
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          Accept: "application/json",
        },
      }
    );
    requests += 1;
    response.results.forEach((event) => {
      const sourceState =
        event.cancelled || event.deleted_reason === "cancelled"
          ? "cancelled"
          : event.postponed || event.deleted_reason === "postponed"
          ? "postponed"
          : event.state === "deleted"
          ? "removed"
          : event.state;
      candidates.push({
        provider: "predicthq",
        providerEventId: event.id,
        sourceUrl: `https://api.predicthq.com/v1/events/${event.id}/`,
        publicSourceUrl: null,
        title: event.title,
        category: event.category,
        venue:
          event.entities?.find((entity) => entity.type === "venue")?.name ??
          null,
        latitude: event.location[1],
        longitude: event.location[0],
        regionScope: null,
        startAt: event.start,
        endAt: event.end ?? event.predicted_end ?? event.start,
        sourceState,
        providerDuplicateOfId: event.duplicate_of_id ?? null,
        providerDeletedReason: event.deleted_reason ?? null,
        providerCancelledAt: event.cancelled ?? null,
        providerPostponedAt: event.postponed ?? null,
        certainty: event.state === "predicted" ? "provisional" : "confirmed",
        localRank: event.local_rank ?? null,
        attendance: event.phq_attendance ?? null,
        venueCapacity: null,
        evidenceText: null,
        primarySourceConfirmed: false,
      });
    });
    next = response.next;
  }

  return { source: "predicthq", candidates, requests, usage: {} };
}
