import { isPublishableDemand } from "../events/importance";
import { eventLocalDate } from "../events/normalize";
import type { ExportChoice, ExportEvent, ExportMode, ExportSnapshot } from "./types";

export const pairKey = (eventId: string, hotelId: string) => `${hotelId}:${eventId}`;

export function selectExportEvents(events: ExportEvent[], mode: ExportMode, selectedPairs: string[], choices: ExportChoice[]) {
  const selected = new Set(selectedPairs);
  return events.map((event) => ({ ...event, hotels: event.hotels.flatMap((hotel) => {
    const key = pairKey(event.id, hotel.id);
    if (hotel.available === false || (mode === "new" && hotel.exportedAt) || (mode === "selected" && !selected.has(key))) return [];
    if (isPublishableDemand(hotel.importance, hotel.impactBasis)) return [hotel];
    const choice = choices.find((choice) => choice.eventId === event.id && choice.hotelId === hotel.id);
    // Remembering a value never implies consent to export an announcement.
    if (!hotel.announced || !selected.has(key) || !choice) return [];
    return [{ ...hotel, exportLevel: choice.importance, manuallySelected: true }];
  }) })).filter((event) => event.hotels.length);
}

export function exportSnapshots(events: ExportEvent[]): ExportSnapshot[] {
  return events.flatMap((event) => event.hotels.map((hotel) => {
    const level = hotel.manuallySelected && hotel.exportLevel ? hotel.exportLevel : hotel.importance;
    return { eventId: event.id, hotelId: hotel.id, title: event.title, startDate: eventLocalDate(event.startAt), endDate: eventLocalDate(event.endAt), hotelCode: hotel.code,
      importance: level === "Peak" ? "High" : level, status: event.status ?? "active", manual: Boolean(hotel.manuallySelected) };
  }));
}

export function currentExportSnapshot(event: ExportEvent | undefined, hotelId: string, previous: ExportSnapshot): { snapshot: ExportSnapshot | null; eligible: boolean; changed: boolean } {
  const hotel = event?.hotels.find((hotel) => hotel.id === hotelId);
  if (!event || !hotel) return { snapshot: null, eligible: false, changed: true };
  const eligible = hotel.available !== false && (isPublishableDemand(hotel.importance, hotel.impactBasis) || Boolean(hotel.announced && hotel.exportLevel));
  const snapshot = exportSnapshots([{ ...event, hotels: [{ ...hotel, manuallySelected: Boolean(hotel.announced && hotel.exportLevel) }] }])[0];
  const fields = ["title", "startDate", "endDate", "hotelCode", "importance", "status"] as const;
  return { snapshot, eligible, changed: !eligible || fields.some((field) => snapshot[field] !== previous[field]) };
}
