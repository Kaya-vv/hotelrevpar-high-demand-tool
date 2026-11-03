import { isPublishableDemand, type DemandLevel } from "../events/importance";
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
    // Selecting a shown Medium event is consent to export it; Medium is the default level.
    if (!hotel.announced || !selected.has(key)) return [];
    return [{ ...hotel, exportLevel: choice?.importance ?? "Medium", manuallySelected: true }];
  }) })).filter((event) => event.hotels.length);
}

export function exportSnapshots(events: ExportEvent[]): ExportSnapshot[] {
  return events.flatMap((event) => event.hotels.map((hotel) => {
    const level = hotel.manuallySelected && hotel.exportLevel ? hotel.exportLevel : hotel.importance;
    return { eventId: event.id, hotelId: hotel.id, title: event.title, startDate: eventLocalDate(event.startAt), endDate: eventLocalDate(event.endAt), hotelCode: hotel.code,
      importance: level === "Peak" ? "High" : level, status: event.status ?? "active", manual: Boolean(hotel.manuallySelected) };
  }));
}

/** Whether a hotel's row belongs in the saved export selection, and at which level. Null = not exported. */
export function exportedLevel(hotel: ExportEvent["hotels"][number]): DemandLevel | null {
  if (hotel.available === false) return null;
  if (isPublishableDemand(hotel.importance, hotel.impactBasis)) return hotel.importance;
  return hotel.announced && hotel.exportLevel ? hotel.exportLevel : null;
}

export function currentExportSnapshot(event: ExportEvent | undefined, hotelId: string, previous: ExportSnapshot): { snapshot: ExportSnapshot | null; eligible: boolean; changed: boolean } {
  const hotel = event?.hotels.find((hotel) => hotel.id === hotelId);
  if (!event || !hotel) return { snapshot: null, eligible: false, changed: true };
  const eligible = exportedLevel(hotel) !== null;
  const snapshot = exportSnapshots([{ ...event, hotels: [{ ...hotel, manuallySelected: Boolean(hotel.announced && hotel.exportLevel) }] }])[0];
  const fields = ["title", "startDate", "endDate", "hotelCode", "importance", "status"] as const;
  return { snapshot, eligible, changed: !eligible || fields.some((field) => snapshot[field] !== previous[field]) };
}
