// Read-only audit of what a hotel's calendar actually shows, split by how each event earned its
// place: a publishable grade, or the unlevelled "Hotelvraag" announcement band. No writes, no
// provider calls. Usage: node scripts/calendar-audit.mjs [hotelNameSubstring]
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "vite";

const env = Object.fromEntries(readFileSync(".env.production.local", "utf8").split("\n")
  .filter((line) => /^[A-Z_]+=/.test(line)).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]));
const api = async (path) => {
  const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`,
    { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
};
const batched = async (ids, build) => {
  const out = [];
  for (let index = 0; index < ids.length; index += 40) out.push(...await api(build(ids.slice(index, index + 40).join(","))));
  return out;
};

const server = await createServer({ configFile: false, logLevel: "error", resolve: { alias: { "@": resolve("src") } }, server: { middlewareMode: true, hmr: false } });
const { isAnnouncedLongRange, isPublishableDemand } = await server.ssrLoadModule("/src/features/events/importance.ts");
const { readDemandAssessment, hasHotelDemand } = await server.ssrLoadModule("/src/features/events/demand-assessment.ts");
const { isEnabledPrimarySource } = await server.ssrLoadModule("/src/features/events/source-evidence.ts");
// The calendar converts to LOCAL dates; slicing UTC inflates a CET-boundary event by a day.
const { eventLocalDate, perPerformanceCategory } = await server.ssrLoadModule("/src/features/events/normalize.ts");

const filter = process.argv[2] ?? "utrecht";
const areas = (await api("collection_areas?select=id,name,account_id,hotel_id,enabled_sources"))
  .filter((area) => area.name.toLowerCase().includes(filter.toLowerCase()));

// The calendar's own horizon: 90 days from today, matching `calendar/query.ts`.
const nearTermHorizon = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
const localDate = (value) => eventLocalDate(value);

for (const area of areas) {
  const [hotel] = await api(`hotels?id=eq.${area.hotel_id}&select=demand_radius_km`);
  const links = await api(`account_event_areas?collection_area_id=eq.${area.id}&select=event_id`);
  const ids = [...new Set(links.map((link) => link.event_id))];
  if (!ids.length) continue;
  const decisions = await batched(ids, (list) => `account_events?account_id=eq.${area.account_id}&event_id=in.(${list})&select=event_id,state`);
  const activeIds = decisions.filter((decision) => decision.state === "active").map((decision) => decision.event_id);
  const events = await batched(activeIds, (list) => `events?id=in.(${list})&select=id,title,category,start_at,end_at`);
  const sources = await batched(activeIds, (list) => `event_sources?event_id=in.(${list})&select=*`);
  const scores = await batched(activeIds, (list) => `hotel_event_scores?hotel_id=eq.${area.hotel_id}&event_id=in.(${list})&select=*`);

  const graded = [];
  const announced = [];
  for (const event of events) {
    const eventSources = sources.filter((source) => source.event_id === event.id
      && isEnabledPrimarySource(source, area.enabled_sources));
    if (!eventSources.length) continue;
    const eventScores = scores.filter((score) => score.event_id === event.id).map((score) => ({
      importance: score.importance_override ?? score.suggested_importance,
      impactBasis: score.impact_basis, distanceKm: score.distance_km,
      assessment: score.demand_assessment, total: score.total,
    }));
    const start = localDate(event.start_at);
    const end = localDate(event.end_at);
    const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
    const publishable = eventScores.find((score) => isPublishableDemand(score.importance, score.impactBasis));
    if (publishable) { graded.push({ event, start, days, score: publishable }); continue; }
    const hasConfirmedDateAndLocation = eventSources.some((source) => source.primary_source_confirmed);
    if (!isAnnouncedLongRange({ startDate: start, endDate: end, nearTermHorizon, category: event.category,
      demandRadiusKm: hotel.demand_radius_km, hasConfirmedDateAndLocation, scores: eventScores })) continue;
    // Which branch admitted it? These mirror `isAnnouncedLongRange` exactly. An event can satisfy
    // both; the label must name every trigger, or removing one looks more destructive than it is.
    const withinRadius = eventScores.some((score) => score.distanceKm !== null && score.distanceKm <= hotel.demand_radius_km);
    const evidenced = withinRadius && eventScores.some((score) => hasHotelDemand(readDemandAssessment(score.assessment)));
    const destination = days >= 3 && !perPerformanceCategory(event.category)
      && hasConfirmedDateAndLocation && withinRadius;
    announced.push({ event, start, days, evidenced, destination, scores: eventScores });
  }

  console.log(`\n=== ${area.name} — ${graded.length} graded, ${announced.length} announced (Hotelvraag) ===`);
  console.log(`horizon ${nearTermHorizon}, radius ${hotel.demand_radius_km} km\n`);
  console.log("-- graded (High/Peak, exportable automatically) --");
  for (const row of graded.sort((a, b) => a.start.localeCompare(b.start)))
    console.log(`  ${row.start} ${String(row.days).padStart(2)}d ${String(row.score.total).padStart(3)}/${row.score.importance.padEnd(5)} ${row.score.impactBasis.padEnd(14)} ${row.event.title.slice(0, 48)}`);
  console.log("\n-- announced, no level (hotel must set export level by hand) --");
  for (const row of announced.sort((a, b) => a.start.localeCompare(b.start)))
    console.log(`  ${row.start} ${String(row.days).padStart(2)}d ${[row.evidenced && "evidence", row.destination && "destination"].filter(Boolean).join("+").padEnd(20)} tot=${String(row.scores[0]?.total ?? "-").padStart(3)} ${row.event.title.slice(0, 46)}`);
  const byBranch = announced.reduce((acc, row) => {
    const key = [row.evidenced && "evidence", row.destination && "destination"].filter(Boolean).join("+") || "none";
    acc[key] = (acc[key] ?? 0) + 1; return acc;
  }, {});
  console.log(`\n  announced by trigger: ${JSON.stringify(byBranch)}`);
}
await server.close();
