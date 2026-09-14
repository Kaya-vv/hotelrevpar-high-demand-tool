// THROWAWAY read-only check of three manually added 2027 editions. No writes.
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

const server = await createServer({ configFile: false, logLevel: "error", resolve: { alias: { "@": resolve("src") } }, server: { middlewareMode: true, hmr: false } });
const { isAnnouncedLongRange, isPublishableDemand } = await server.ssrLoadModule("/src/features/events/importance.ts");
const { readDemandAssessment, hasHotelDemand } = await server.ssrLoadModule("/src/features/events/demand-assessment.ts");
const { readEventEvidence } = await server.ssrLoadModule("/src/features/events/evidence.ts");
const { eventLocalDate, perPerformanceCategory } = await server.ssrLoadModule("/src/features/events/normalize.ts");
const { isEnabledPrimarySource } = await server.ssrLoadModule("/src/features/events/source-evidence.ts");

const horizon = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
const wanted = ["Freshtival", "Onder De Radar", "Concert at SEA"];

for (const name of wanted) {
  const events = await api(`events?title=ilike.*${encodeURIComponent(name)}*&select=*`);
  if (!events.length) { console.log(`\n### ${name}: NIET in de database`); continue; }
  for (const event of events) {
    const sources = await api(`event_sources?event_id=eq.${event.id}&select=*`);
    const scores = await api(`hotel_event_scores?event_id=eq.${event.id}&select=*`);
    const links = await api(`account_event_areas?event_id=eq.${event.id}&select=collection_area_id,account_id`);
    const decisions = await api(`account_events?event_id=eq.${event.id}&select=account_id,state,review_reason`);
    const start = eventLocalDate(event.start_at);
    const end = eventLocalDate(event.end_at);
    const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
    console.log(`\n### ${event.title}  [${event.id}]`);
    console.log(`  ${start} .. ${end}  (${days} dagen)  categorie=${event.category}  certainty=${event.certainty}  state=${event.source_state}`);
    console.log(`  coordinaten: ${event.latitude === null ? "GEEN" : `${event.latitude.toFixed(4)}, ${event.longitude.toFixed(4)}`}  venue=${event.venue ?? "-"}`);
    console.log(`  per-voorstelling categorie? ${perPerformanceCategory(event.category)}`);
    console.log(`  beslissingen: ${decisions.map((d) => `${d.state}${d.review_reason ? `/${d.review_reason}` : ""}`).join(", ") || "geen"}`);
    for (const source of sources) {
      const evidence = readEventEvidence(source.evidence);
      console.log(`  bron ${source.provider}: state=${source.source_state} confirmed=${source.primary_source_confirmed} publicUrl=${source.public_source_url ? "ja" : "NEE"}`);
      console.log(`     dateText=${evidence?.dateText ? "ja" : "NEE"} locationText=${evidence?.locationText ? "ja" : "NEE"} demandFeiten=${evidence?.demand.length ?? 0}`);
    }
    for (const score of scores) {
      const [hotel] = await api(`hotels?id=eq.${score.hotel_id}&select=name,demand_radius_km`);
      const [area] = await api(`collection_areas?hotel_id=eq.${score.hotel_id}&select=id,enabled_sources`);
      const assessment = readDemandAssessment(score.demand_assessment);
      const eventScores = [{ importance: score.importance_override ?? score.suggested_importance, impactBasis: score.impact_basis, distanceKm: score.distance_km, assessment: score.demand_assessment }];
      const hasConfirmedDateAndLocation = sources.some((source) => {
        if (!isEnabledPrimarySource(source, area?.enabled_sources ?? [])) return false;
        const evidence = readEventEvidence(source.evidence);
        return Boolean(evidence?.dateText && evidence.locationText);
      });
      const announced = isAnnouncedLongRange({ startDate: start, endDate: end, nearTermHorizon: horizon,
        demandRadiusKm: hotel?.demand_radius_km ?? null, category: event.category, hasConfirmedDateAndLocation, scores: eventScores });
      const graded = isPublishableDemand(eventScores[0].importance, score.impact_basis);
      console.log(`  score voor ${hotel?.name}: totaal=${score.total} ${eventScores[0].importance} basis=${score.impact_basis} afstand=${score.distance_km === null ? "ONBEKEND" : `${score.distance_km.toFixed(1)} km / ${hotel?.demand_radius_km} km`}`);
      console.log(`     vraagbeoordeling=${assessment?.relevance ?? "geen"}/${assessment?.magnitude ?? "-"}  hotelvraag=${hasHotelDemand(assessment)}`);
      console.log(`     datum+locatie bevestigd op ingeschakelde bron: ${hasConfirmedDateAndLocation}`);
      console.log(`     >>> ZICHTBAAR? gegradeerd=${graded}  aangekondigd=${announced}  => ${graded || announced ? "JA" : "NEE"}`);
    }
    if (!scores.length) console.log(`  GEEN hotelscores  (gebiedskoppelingen: ${links.length})`);
  }
}
await server.close();
