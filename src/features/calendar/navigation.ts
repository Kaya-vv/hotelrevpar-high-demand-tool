import { eventLocalDate } from "@/features/events/normalize";

export type OverviewPeriod = "3" | "12" | "all";

export function monthLabel(month: string) {
  return new Intl.DateTimeFormat("nl-NL", {
    month: "long", year: "numeric", timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00Z`));
}

export function changeMonth(month: string, offset: number) {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number - 1 + offset, 1)).toISOString().slice(0, 7);
}

export function calendarBounds(
  month: string,
  view: "list" | "calendar" = "calendar",
  period: OverviewPeriod = "all",
  now = new Date(),
) {
  if (view === "calendar") {
    const [year, number] = month.split("-").map(Number);
    return { start: `${month}-01`, end: new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10) };
  }
  const start = eventLocalDate(now.toISOString());
  const [year, number, day] = start.split("-").map(Number);
  if (period === "all") return { start, end: `${year + 1}-12-31` };
  const targetMonth = changeMonth(start.slice(0, 7), Number(period));
  const lastDay = new Date(Date.UTC(year, number + Number(period), 0)).getUTCDate();
  return { start, end: `${targetMonth}-${String(Math.min(day, lastDay)).padStart(2, "0")}` };
}

export function overviewMonth(startAt: string, rangeStart?: string) {
  const month = eventLocalDate(startAt).slice(0, 7);
  return rangeStart && month < rangeStart.slice(0, 7) ? rangeStart.slice(0, 7) : month;
}
