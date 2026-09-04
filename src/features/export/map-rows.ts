import { isPublishableDemand } from "@/features/events/importance";

import type { ExportEvent, RevControlRow } from "./types";

function excelDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function publishableHotels(event: ExportEvent, selected: Set<string>) {
  return event.hotels.filter(
    (hotel) => selected.has(hotel.id) && isPublishableDemand(hotel.importance, hotel.impactBasis),
  );
}

/** The events that actually reach the workbook, so a preview count matches its rows. */
export function exportableEvents(events: ExportEvent[], selectedHotelIds: string[]): ExportEvent[] {
  const selected = new Set(selectedHotelIds);
  return events.filter((event) => publishableHotels(event, selected).length > 0);
}

export function mapRevControlRows(events: ExportEvent[], selectedHotelIds: string[]): RevControlRow[] {
  const selected = new Set(selectedHotelIds);
  return events
    .flatMap((event) => {
      const groups = new Map<RevControlRow["importance"], string[]>();
      publishableHotels(event, selected).forEach((hotel) => {
        const importance = hotel.importance === "Peak" ? "High" : hotel.importance;
        groups.set(importance, [...(groups.get(importance) ?? []), hotel.code]);
      });
      return [...groups].map(([importance, hotels]) => ({
        show: "Yes" as const,
        event: event.title,
        startDate: excelDate(event.startAt),
        endDate: excelDate(event.endAt),
        importance,
        supplementPercentage: null,
        supplement: null,
        mls: null,
        addSupplementFor: "Both" as const,
        hotels: hotels.join(", "),
        splitPerHotel: null,
        note: null,
        source: null,
      }));
    })
    .sort((left, right) =>
      left.startDate.getTime() - right.startDate.getTime() ||
      left.event.localeCompare(right.event, "nl") ||
      left.importance.localeCompare(right.importance),
    );
}

