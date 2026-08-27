import { z } from "zod";

import { fetchJson } from "../http";
import type { CollectionWindow, Fetcher, SourceResult } from "../types";

const responseSchema = z.array(
  z.object({
    id: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    name: z.array(z.object({ language: z.string(), text: z.string() })),
    regionalScope: z.string(),
    nationwide: z.boolean(),
  }),
);

export async function collectOpenHolidays(
  input: CollectionWindow & { fetcher?: Fetcher },
): Promise<SourceResult> {
  const url = new URL("https://openholidaysapi.org/PublicHolidays");
  url.search = new URLSearchParams({
    countryIsoCode: "NL",
    languageIsoCode: "NL",
    validFrom: input.start,
    validTo: input.end,
  }).toString();
  const holidays = await fetchJson(url, responseSchema, input.fetcher);
  const candidates = holidays
    .filter((holiday) => holiday.startDate <= input.end && holiday.endDate >= input.start)
    .map((holiday) => ({
      provider: "openholidays" as const,
      providerEventId: holiday.id,
      sourceUrl: `${url.toString()}#${holiday.id}`,
      title: holiday.name.find((name) => name.language.toUpperCase() === "NL")?.text ?? holiday.name[0]?.text ?? "Feestdag",
      category: "public_holiday",
      venue: null,
      latitude: null,
      longitude: null,
      regionScope: holiday.nationwide ? "national" : holiday.regionalScope,
      startAt: `${holiday.startDate}T00:00:00Z`,
      endAt: `${holiday.endDate}T23:59:59Z`,
      sourceState: "active" as const,
      certainty: "confirmed" as const,
      localRank: null,
      attendance: null,
      venueCapacity: null,
      evidenceText: null,
      primarySourceConfirmed: true,
    }));

  return { source: "openholidays", candidates, requests: 1, usage: {} };
}

