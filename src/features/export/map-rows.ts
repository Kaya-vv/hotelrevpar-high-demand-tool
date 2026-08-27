import type { ExportEvent, RevControlRow } from "./types";

function excelDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function mapRevControlRows(events: ExportEvent[], selectedHotelIds: string[]): RevControlRow[] {
  const selected = new Set(selectedHotelIds);
  return events
    .flatMap((event) => {
      const groups = new Map<RevControlRow["importance"], string[]>();
      event.hotels.forEach((hotel) => {
        if (!selected.has(hotel.id)) return;
        groups.set(hotel.importance, [...(groups.get(hotel.importance) ?? []), hotel.code]);
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
        addSupplementFor: null,
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

