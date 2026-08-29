import type { CollectionWindow, SourceResult } from "../types";

const sourceUrl = "https://www.uefa.com/uefachampionsleague/news/02a6-20d57cfcd03e-407c22a7f465-1000--2026-27-champions-league-teams-dates-draws-format-final/";

const clubs = [
  { id: "psv", name: "PSV", venue: "Philips Stadion", latitude: 51.4416, longitude: 5.4673, attendance: 35_000, localRank: 91 },
  { id: "feyenoord", name: "Feyenoord", venue: "De Kuip", latitude: 51.8939, longitude: 4.5233, attendance: 51_000, localRank: 93 },
] as const;

const matchweeks = [
  { id: "md1", start: "2026-09-08", end: "2026-09-10" },
  { id: "md2", start: "2026-10-13", end: "2026-10-14" },
  { id: "md3", start: "2026-10-20", end: "2026-10-21" },
  { id: "md4", start: "2026-11-03", end: "2026-11-04" },
  { id: "md5", start: "2026-11-24", end: "2026-11-25" },
  { id: "md6", start: "2026-12-08", end: "2026-12-09" },
  { id: "md7", start: "2027-01-19", end: "2027-01-20" },
  { id: "md8", start: "2027-01-27", end: "2027-01-27" },
] as const;

export function collectUefaForecasts(window: CollectionWindow): SourceResult {
  const candidates = clubs.flatMap((club) => matchweeks.flatMap((matchweek) => {
    if (matchweek.start > window.end || matchweek.end < window.start) return [];
    return [{
      provider: "uefa" as const,
      providerEventId: `ucl-2026-27:${club.id}:${matchweek.id}`,
      sourceUrl,
      title: `Potentiële Champions League-thuiswedstrijd ${club.name}`,
      category: "sports",
      venue: club.venue,
      latitude: club.latitude,
      longitude: club.longitude,
      regionScope: null,
      startAt: `${matchweek.start}T18:00:00+02:00`,
      endAt: `${matchweek.end}T23:59:00+02:00`,
      sourceState: "predicted" as const,
      certainty: "provisional" as const,
      localRank: club.localRank,
      attendance: club.attendance,
      venueCapacity: club.attendance,
      evidenceText: "UEFA heeft dit matchweekvenster gepubliceerd; de thuiswedstrijd en exacte speeldag zijn nog niet bevestigd.",
      primarySourceConfirmed: false,
    }];
  }));

  return { source: "uefa", candidates, requests: 0, usage: {} };
}
