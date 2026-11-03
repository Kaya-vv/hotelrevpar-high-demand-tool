import { isPublishableDemand, type DemandLevel } from "../events/importance";
import { eventLocalDate } from "../events/normalize";
import type { ExportEvent, ExportMinLevel, ExportMode, ExportSnapshot } from "./types";

export const pairKey = (eventId: string, hotelId: string) => `${hotelId}:${eventId}`;

const rank: Record<DemandLevel, number> = { Low: 0, Medium: 1, High: 2, Peak: 3 };

/**
 * Whether a hotel's row is exported, and at which level. Null = not exported. Each event has one
 * level, the calendar's; the account's minimum decides from which level up events leave
 * DemandRadar. The Excel export and the API both use this rule.
 */
export function exportedLevel(hotel: ExportEvent["hotels"][number], minLevel: ExportMinLevel): DemandLevel | null {
  const level: DemandLevel | null = hotel.laag ? "Low"
    : hotel.available === false ? null
    : isPublishableDemand(hotel.importance, hotel.impactBasis) ? hotel.importance
    : hotel.announced ? "Medium"
    : null;
  return level && rank[level] >= rank[minLevel] ? level : null;
}

export function selectExportEvents(events: ExportEvent[], mode: ExportMode, selectedPairs: string[], minLevel: ExportMinLevel) {
  const selected = new Set(selectedPairs);
  return events.map((event) => ({ ...event, hotels: event.hotels.filter((hotel) =>
    !(mode === "new" && hotel.exportedAt) && !(mode === "selected" && !selected.has(pairKey(event.id, hotel.id)))
    && exportedLevel(hotel, minLevel) !== null) })).filter((event) => event.hotels.length);
}

export function exportSnapshots(events: ExportEvent[]): ExportSnapshot[] {
  return events.flatMap((event) => event.hotels.map((hotel) => {
    const level = exportedLevel(hotel, "Low") ?? hotel.importance;
    return { eventId: event.id, hotelId: hotel.id, title: event.title, startDate: eventLocalDate(event.startAt), endDate: eventLocalDate(event.endAt), hotelCode: hotel.code,
      // `manual`: sent because of the account's choice rather than an earned High or Peak grade.
      importance: level === "Peak" ? "High" : level, status: event.status ?? "active", manual: Boolean(hotel.announced || hotel.laag) };
  }));
}

/** History compares against everything exportable, so a stricter account setting does not mark old rows as changed. */
export function currentExportSnapshot(event: ExportEvent | undefined, hotelId: string, previous: ExportSnapshot): { snapshot: ExportSnapshot | null; eligible: boolean; changed: boolean } {
  const hotel = event?.hotels.find((hotel) => hotel.id === hotelId);
  if (!event || !hotel) return { snapshot: null, eligible: false, changed: true };
  const eligible = exportedLevel(hotel, "Low") !== null;
  const snapshot = exportSnapshots([{ ...event, hotels: [hotel] }])[0];
  const fields = ["title", "startDate", "endDate", "hotelCode", "importance", "status"] as const;
  return { snapshot, eligible, changed: !eligible || fields.some((field) => snapshot[field] !== previous[field]) };
}
