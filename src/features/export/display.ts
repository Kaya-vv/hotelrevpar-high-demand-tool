import { eventLocalDate } from "../events/normalize";

export function exportPeriod(start: string, end: string) {
  return new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).formatRange(
    new Date(`${eventLocalDate(start)}T12:00:00Z`), new Date(`${eventLocalDate(end)}T12:00:00Z`),
  );
}

export function exportMonth(value: string) {
  return new Date(`${eventLocalDate(value)}T12:00:00Z`).toLocaleDateString("nl-NL", { month: "long", year: "numeric", timeZone: "UTC" });
}
