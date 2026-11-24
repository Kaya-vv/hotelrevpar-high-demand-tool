import { z } from "zod";

import { fetchJson } from "../http";
import type { CollectionWindow, Fetcher, SourceResult } from "../types";

const responseSchema = z.array(
  z.object({
    id: z.string(),
    canonical: z.url(),
    content: z.array(
      z.object({
        vacations: z.array(
          z.object({
            type: z.string(),
            regions: z.array(
              z.object({ region: z.string(), startdate: z.string(), enddate: z.string() }),
            ),
          }),
        ),
      }),
    ),
  }),
);

function regionScope(region: string) {
  const value = region.trim().toLowerCase();
  return ({ noord: "north", midden: "middle", zuid: "south", "heel nederland": "national" } as Record<string, string>)[value] ?? value;
}

// Every hotel receives all three regions' holidays, so the name says whose it is. A nationwide
// holiday (Christmas, May) keeps its plain name.
const regionNames: Record<string, string> = { north: "Noord", middle: "Midden", south: "Zuid" };
function title(type: string, region: string) {
  const name = regionNames[regionScope(region)];
  return name ? `${type.trim()} ${name}` : type.trim();
}

export async function collectRijksoverheid(
  input: CollectionWindow & { fetcher?: Fetcher },
): Promise<SourceResult> {
  const records = await fetchJson(
    "https://opendata.rijksoverheid.nl/v1/infotypes/schoolholidays",
    responseSchema,
    input.fetcher,
  );
  const candidates = records.flatMap((record) =>
    record.content.flatMap((content) =>
      content.vacations.flatMap((vacation) =>
        vacation.regions
          .filter((region) => region.startdate.slice(0, 10) <= input.end && region.enddate.slice(0, 10) >= input.start)
          .map((region) => ({
            provider: "rijksoverheid" as const,
            providerEventId: [record.id, vacation.type.trim(), region.region, region.startdate].join(":"),
            sourceUrl: record.canonical,
            title: title(vacation.type, region.region),
            category: "school_holiday",
            venue: null,
            latitude: null,
            longitude: null,
            regionScope: regionScope(region.region),
            startAt: region.startdate,
            endAt: region.enddate,
            sourceState: "active" as const,
            certainty: "confirmed" as const,
            localRank: null,
            attendance: null,
            venueCapacity: null,
            evidenceText: null,
            primarySourceConfirmed: true,
          })),
      ),
    ),
  );

  return { source: "rijksoverheid", candidates, requests: 1, usage: {} };
}
