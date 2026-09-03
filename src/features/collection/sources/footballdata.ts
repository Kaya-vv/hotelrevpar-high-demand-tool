import { z } from "zod";

import { fetchJson } from "../http";
import type { CollectionWindow, Fetcher, SourceResult } from "../types";

// Dutch clubs that can host a Champions League tie. The table doubles as the
// "is this a Dutch home match" filter: an unlisted home team is skipped.
const dutchHomeVenues: Array<{
  match: RegExp;
  venue: string;
  latitude: number;
  longitude: number;
  website: string;
}> = [
  { match: /\bpsv\b/i, venue: "Philips Stadion", latitude: 51.4417, longitude: 5.4675, website: "https://www.psv.nl" },
  { match: /\bajax\b/i, venue: "Johan Cruijff ArenA", latitude: 52.3143, longitude: 4.9419, website: "https://www.ajax.nl" },
  { match: /\bfeyenoord\b/i, venue: "Stadion Feijenoord", latitude: 51.8939, longitude: 4.5231, website: "https://www.feyenoord.nl" },
  { match: /\baz\b/i, venue: "AFAS Stadion", latitude: 52.6128, longitude: 4.7434, website: "https://www.az.nl" },
  { match: /\btwente\b/i, venue: "De Grolsch Veste", latitude: 52.2366, longitude: 6.8375, website: "https://www.fctwente.nl" },
];

const teamSchema = z.object({
  name: z.string(),
  shortName: z.string().nullish(),
});

const responseSchema = z.object({
  matches: z
    .array(
      z.object({
        id: z.number(),
        utcDate: z.string(),
        status: z.string(),
        homeTeam: teamSchema,
        awayTeam: teamSchema,
      }),
    )
    .default([]),
});

function state(status: string) {
  if (status === "CANCELLED") return "cancelled" as const;
  if (status === "POSTPONED" || status === "SUSPENDED") return "postponed" as const;
  return "active" as const;
}

export async function collectFootballdata(
  input: CollectionWindow & { apiKey: string; fetcher?: Fetcher },
): Promise<SourceResult> {
  const candidates: SourceResult["candidates"] = [];
  const response = await fetchJson(
    "https://api.football-data.org/v4/competitions/CL/matches",
    responseSchema,
    input.fetcher,
    { headers: { "X-Auth-Token": input.apiKey } },
  );

  response.matches.forEach((match) => {
    const day = match.utcDate.slice(0, 10);
    if (day < input.start || day > input.end) return;
    const home = dutchHomeVenues.find((entry) => entry.match.test(match.homeTeam.name));
    if (!home) return;

    const startAt = new Date(match.utcDate).toISOString();
    const endAt = new Date(new Date(match.utcDate).getTime() + 2 * 60 * 60 * 1000).toISOString();
    const homeName = match.homeTeam.shortName ?? match.homeTeam.name;
    const awayName = match.awayTeam.shortName ?? match.awayTeam.name;

    candidates.push({
      provider: "footballdata",
      providerEventId: String(match.id),
      sourceUrl: `https://api.football-data.org/v4/matches/${match.id}`,
      publicSourceUrl: home.website,
      title: `${homeName} - ${awayName} (Champions League)`,
      category: "sports",
      venue: home.venue,
      latitude: home.latitude,
      longitude: home.longitude,
      regionScope: "international",
      startAt,
      endAt,
      sourceState: state(match.status),
      certainty: "confirmed",
      localRank: null,
      attendance: null,
      venueCapacity: null,
      evidenceText: null,
      primarySourceConfirmed: true,
    });
  });

  return { source: "footballdata", candidates, requests: 1, usage: {} };
}
