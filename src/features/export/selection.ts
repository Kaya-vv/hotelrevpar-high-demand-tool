import { isPublishableDemand, type DemandLevel } from "../events/importance";
import { eventLocalDate } from "../events/normalize";
import type { ExportChoice, ExportEvent, ExportMode, ExportSnapshot } from "./types";

export const pairKey = (eventId: string, hotelId: string) => `${hotelId}:${eventId}`;

/**
 * Whether a hotel's row is exported, and at which level. Null = not exported. High and Peak go at
 * their own level; a shown Medium event goes at the level the manager last exported it with,
 * else Medium. Everything else stays out. The Excel export and the API both use this rule.
 */
export function exportedLevel(hotel: ExportEvent["hotels"][number]): DemandLevel | null {
  if (hotel.available === false) return null;
  if (isPublishableDemand(hotel.importance, hotel.impactBasis)) return hotel.importance;
  return hotel.announced ? hotel.exportLevel ?? "Medium" : null;
}

export function selectExportEvents(events: ExportEvent[], mode: ExportMode, selectedPairs: string[], choices: ExportChoice[]) {
  const selected = new Set(selectedPairs);
  return events.map((event) => ({ ...event, hotels: event.hotels.flatMap((hotel) => {
    if ((mode === "new" && hotel.exportedAt) || (mode === "selected" && !selected.has(pairKey(event.id, hotel.id)))) return [];
    if (exportedLevel(hotel) === null) return [];
    if (!hotel.announced) return [hotel];
    // A level picked in this export replaces the saved one for this Medium event.
    const choice = choices.find((choice) => choice.eventId === event.id && choice.hotelId === hotel.id);
    return [{ ...hotel, exportLevel: choice?.importance ?? hotel.exportLevel ?? "Medium" }];
  }) })).filter((event) => event.hotels.length);
}

export function exportSnapshots(events: ExportEvent[]): ExportSnapshot[] {
  return events.flatMap((event) => event.hotels.map((hotel) => {
    const level = exportedLevel(hotel) ?? hotel.importance;
    return { eventId: event.id, hotelId: hotel.id, title: event.title, startDate: eventLocalDate(event.startAt), endDate: eventLocalDate(event.endAt), hotelCode: hotel.code,
      importance: level === "Peak" ? "High" : level, status: event.status ?? "active", manual: Boolean(hotel.announced) };
  }));
}

export function currentExportSnapshot(event: ExportEvent | undefined, hotelId: string, previous: ExportSnapshot): { snapshot: ExportSnapshot | null; eligible: boolean; changed: boolean } {
  const hotel = event?.hotels.find((hotel) => hotel.id === hotelId);
  if (!event || !hotel) return { snapshot: null, eligible: false, changed: true };
  const eligible = exportedLevel(hotel) !== null;
  const snapshot = exportSnapshots([{ ...event, hotels: [hotel] }])[0];
  const fields = ["title", "startDate", "endDate", "hotelCode", "importance", "status"] as const;
  return { snapshot, eligible, changed: !eligible || fields.some((field) => snapshot[field] !== previous[field]) };
}
