import { eventLocalDate, normalizeText, perPerformanceCategory } from "@/features/events/normalize";
import type { EventCandidate } from "@/features/events/types";

/** One stored source of an event the collection area already holds. */
export type StoredSource = {
  eventId: string;
  provider: string;
  providerEventId: string;
  sourceUrl: string;
  title: string;
  startAt: string;
};

export type MovedSource = { eventId: string; fromProviderEventId: string; toProviderEventId: string };

// A postponement moves an event by weeks or months. A year apart is the next edition, which must
// keep its own ID: the 2026 and 2027 TCS Amsterdam Marathon share one title and one website.
const MAX_MOVE_DAYS = 120;

function pageKey(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return null;
  }
}

function key(url: string, title: string) {
  const page = pageKey(url);
  return page ? `${page}\0${normalizeText(title)}` : null;
}

/**
 * A Claude source ID hashes the event date, so a page that moves an event to a new date yields a
 * new ID, and the event used to be saved a second time while the old date stayed in the calendar.
 * This finds the stored source such a candidate replaces, so the event keeps its ID.
 *
 * Deliberately strict, because moving a date that still happens loses a real event:
 * - the stored event's own page was re-read in full this run (`refreshedUrls`); a title search
 *   returns only the event it searched for, so a date missing from it proves nothing;
 * - that page reports the same title once, under an ID not stored yet;
 * - the area holds exactly one upcoming event under that page and title, and no source of that
 *   event was reported again in this run (the page no longer shows its old date);
 * - the event has only Claude sources: other providers carry stable IDs and move it themselves;
 * - concerts and shows are excluded: their pages list a rolling set of nights;
 * - the dates differ by more than a day (the normal match covers a day) and at most 120 days.
 */
export function movedClaudeSources(reported: EventCandidate[], refreshedUrls: string[], stored: StoredSource[], today: string): MovedSource[] {
  const refreshedPages = new Set(refreshedUrls.map(pageKey));
  const claude = reported.filter((candidate) => candidate.provider === "claude" && candidate.providerEventId);
  const reportedIds = new Set(claude.map((candidate) => candidate.providerEventId));
  const storedClaudeIds = new Set(stored.filter((source) => source.provider === "claude").map((source) => source.providerEventId));
  const confirmedAgain = new Set(stored.filter((source) => source.provider === "claude" && reportedIds.has(source.providerEventId)).map((source) => source.eventId));
  const otherProvider = new Set(stored.filter((source) => source.provider !== "claude").map((source) => source.eventId));

  const reportedByKey = new Map<string, Map<string, EventCandidate>>();
  for (const candidate of claude) {
    const candidateKey = key(candidate.sourceUrl, candidate.title);
    if (!candidateKey) continue;
    const group = reportedByKey.get(candidateKey) ?? new Map<string, EventCandidate>();
    group.set(candidate.providerEventId, candidate);
    reportedByKey.set(candidateKey, group);
  }
  const storedByKey = new Map<string, StoredSource[]>();
  for (const source of stored) {
    if (source.provider !== "claude" || eventLocalDate(source.startAt) <= today || !refreshedPages.has(pageKey(source.sourceUrl))) continue;
    const sourceKey = key(source.sourceUrl, source.title);
    if (!sourceKey) continue;
    storedByKey.set(sourceKey, [...(storedByKey.get(sourceKey) ?? []), source]);
  }

  const moves: MovedSource[] = [];
  const movedEvents = new Set<string>();
  for (const [groupKey, group] of reportedByKey) {
    if (group.size !== 1) continue;
    const [candidate] = group.values();
    if (storedClaudeIds.has(candidate.providerEventId) || perPerformanceCategory(candidate.category)) continue;
    const sources = storedByKey.get(groupKey) ?? [];
    const eventIds = new Set(sources.map((source) => source.eventId));
    if (eventIds.size !== 1) continue;
    const [source] = sources;
    if (confirmedAgain.has(source.eventId) || otherProvider.has(source.eventId) || movedEvents.has(source.eventId)) continue;
    const shift = Math.abs(Date.parse(`${eventLocalDate(candidate.startAt)}T00:00:00Z`) - Date.parse(`${eventLocalDate(source.startAt)}T00:00:00Z`)) / 86_400_000;
    if (shift <= 1 || shift > MAX_MOVE_DAYS) continue;
    movedEvents.add(source.eventId);
    moves.push({ eventId: source.eventId, fromProviderEventId: source.providerEventId, toProviderEventId: candidate.providerEventId });
  }
  return moves;
}
