import type { Lead, ProjectedEdition, SeriesEdition } from "./long-range-store";

const day = 86_400_000;
function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value;
}

export function rememberEdition(lead: Lead, edition: SeriesEdition) {
  if (!validDate(edition.start) || !validDate(edition.end) || edition.end < edition.start) return;
  if (!lead.lastKnownEdition || edition.end > lead.lastKnownEdition.end) {
    lead.lastKnownEdition = edition;
    lead.officialPage = edition.sourceUrl;
  }
}

export function projectEditions(lead: Lead, start: string, end: string): ProjectedEdition[] {
  const basis = lead.lastKnownEdition;
  if (lead.kind !== "event" || lead.outcome === "conflict" || !basis || !validDate(basis.start) || !validDate(basis.end)) return [];
  const duration = (Date.parse(basis.end) - Date.parse(basis.start)) / day;
  // A whole season is not a dated event. Recurrence itself remains an explicit assumption.
  if (duration < 0 || duration > 31) return [];
  const projections: ProjectedEdition[] = [];
  for (let year = Math.max(Number(start.slice(0, 4)), Number(basis.start.slice(0, 4)) + 1); year <= Number(end.slice(0, 4)); year++) {
    const month = Number(basis.start.slice(5, 7));
    const date = Math.min(Number(basis.start.slice(8, 10)), new Date(Date.UTC(year, month, 0)).getUTCDate());
    const projectedStart = new Date(Date.UTC(year, month - 1, date)).toISOString().slice(0, 10);
    const projectedEnd = new Date(Date.parse(projectedStart) + duration * day).toISOString().slice(0, 10);
    if (projectedEnd < start || projectedStart > end || lead.editions.some((edition) => Number(edition.startAt.slice(0, 4)) === year)) continue;
    projections.push({ status: "projected", year, start: projectedStart, end: projectedEnd,
      confidence: "low", method: "annual-calendar-estimate", basedOn: { ...basis } });
  }
  return projections;
}

export function projectionInstructions(lead: Lead) {
  if (!lead.projections?.length) return "";
  // Keep guessed dates out of the extraction prompt to avoid anchoring the model to them.
  return `Internal research target: ${lead.title}, edition year(s) ${lead.projections.map((item) => item.year).join(", ")}. Annual recurrence is only a hypothesis, not evidence. Find an official announcement; report only its actual dates, including dates unlike previous editions. Previously successful official page: ${lead.officialPage ?? "unknown"}.`;
}
