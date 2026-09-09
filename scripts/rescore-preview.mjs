// Re-score stored production evidence with the current scorer, mirroring repository.recalculateScores.
// Read-only: no writes, no provider calls.
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
  for (let index = 0; index < ids.length; index += 50) out.push(...await api(build(ids.slice(index, index + 50).join(","))));
  return out;
};

const server = await createServer({ configFile: false, logLevel: "error", resolve: { alias: { "@": resolve("src") } }, server: { middlewareMode: true, hmr: false } });
const { scoreHotelEvent } = await server.ssrLoadModule("/src/features/events/score.ts");
const { readEventEvidence } = await server.ssrLoadModule("/src/features/events/evidence.ts");
const { isPublishableDemand, isAnnouncedLongRange } = await server.ssrLoadModule("/src/features/events/importance.ts");
const { selectScoreEvidence } = await server.ssrLoadModule("/src/features/events/source-evidence.ts");

const hotelId = process.argv[2] ?? "c22bedf2-178a-4932-9874-6c4d2913722e";
const [hotel] = await api(`hotels?id=eq.${hotelId}&select=id,name,account_id,latitude,longitude,demand_radius_km,holiday_region`);
const [area] = await api(`collection_areas?account_id=eq.${hotel.account_id}&select=enabled_sources&limit=1`);
const scope = { latitude: hotel.latitude, longitude: hotel.longitude, demandRadiusKm: hotel.demand_radius_km, holidayRegion: hotel.holiday_region };

const decisions = await api(`account_events?account_id=eq.${hotel.account_id}&state=eq.active&select=event_id`);
const activeIds = decisions.map((decision) => decision.event_id);
const events = await batched(activeIds, (ids) => `events?id=in.(${ids})&select=*`);
const sources = await batched(activeIds, (ids) => `event_sources?event_id=in.(${ids})&select=*`);
const stored = await batched(activeIds, (ids) => `hotel_event_scores?event_id=in.(${ids})&hotel_id=eq.${hotelId}&select=event_id,total,suggested_importance,impact_basis`);

const candidates = events.flatMap((event) => {
  const evidence = selectScoreEvidence(sources.filter((source) => source.event_id === event.id), area.enabled_sources);
  if (!evidence) return [];
  return [{ eventId: event.id, event, candidate: {
    evidence: readEventEvidence(evidence.evidence),
    provider: evidence.provider, providerEventId: evidence.provider_event_id,
    sourceUrl: evidence.source_url, publicSourceUrl: evidence.public_source_url,
    title: event.title, category: event.category, venue: event.venue,
    latitude: event.latitude, longitude: event.longitude, regionScope: event.region_scope,
    startAt: event.start_at, endAt: event.end_at, sourceState: evidence.source_state,
    providerDuplicateOfId: evidence.provider_duplicate_of_id, providerDeletedReason: evidence.provider_deleted_reason,
    providerCancelledAt: evidence.provider_cancelled_at, providerPostponedAt: evidence.provider_postponed_at,
    certainty: event.certainty, localRank: evidence.local_rank,
    attendance: evidence.attendance, venueCapacity: evidence.venue_capacity,
    aiImpactPoints: evidence.ai_impact_points, overnightAudience: evidence.overnight_audience,
    evidenceText: evidence.evidence_text, primarySourceConfirmed: evidence.primary_source_confirmed,
  } }];
});
// Same two passes production uses: a base score without overlaps, then overlaps from those bases.
const bases = new Map(candidates.map(({ eventId, candidate }) => [eventId, scoreHotelEvent({ candidate, hotel: scope, overlaps: [] })]));
const horizon = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
const rows = candidates.map(({ eventId, event, candidate }) => {
  const overlaps = candidates.filter((other) => other.eventId !== eventId).map((other) => ({
    startAt: other.candidate.startAt, endAt: other.candidate.endAt, preOverlapTotal: bases.get(other.eventId)?.total ?? 0,
  }));
  const score = scoreHotelEvent({ candidate, hotel: scope, overlaps });
  const previous = stored.find((item) => item.event_id === eventId);
  return { title: event.title, start: event.start_at.slice(0, 10), end: (event.end_at ?? event.start_at).slice(0, 10),
    beyondHorizon: event.start_at.slice(0, 10) > horizon, assessment: score.assessment,
    confirmed: event.certainty === "confirmed" && candidate.primarySourceConfirmed,
    distanceKm: score.distanceKm, inRadius: score.distanceKm !== null && score.distanceKm <= scope.demandRadiusKm,
    before: previous?.total ?? null, beforeImp: previous?.suggested_importance ?? "-", beforeBasis: previous?.impact_basis ?? "-",
    after: score.total, afterImp: score.suggestedImportance, afterBasis: score.impactBasis,
    wasVisible: previous ? isPublishableDemand(previous.suggested_importance, previous.impact_basis) : false,
    nowVisible: isPublishableDemand(score.suggestedImportance, score.impactBasis) };
});
const drift = rows.filter((row) => row.before !== null && row.before !== row.after);

console.log(`${hotel.name} — ${rows.length} active scored candidates, horizon ${horizon}\n`);
console.log(`reconstruction check: ${rows.length - drift.length}/${rows.length} totals reproduce the stored score exactly\n`);
console.log("changed by this build:");
for (const row of drift.sort((a, b) => b.after - a.after))
  console.log(`  ${row.wasVisible ? "vis" : "---"} -> ${row.nowVisible ? "VIS" : "---"}  ${String(row.before).padStart(3)}/${row.beforeImp.padEnd(6)} -> ${String(row.after).padStart(3)}/${row.afterImp.padEnd(6)} ${row.afterBasis.padEnd(13)} ${row.start} ${row.title.slice(0, 44)}`);
console.log(`\ntotal publishable: before ${rows.filter((r) => r.wasVisible).length} -> after ${rows.filter((r) => r.nowVisible).length}`);
const far = rows.filter((row) => row.beyondHorizon);
console.log(`beyond horizon: ${far.length} events | visible before ${far.filter((r) => r.wasVisible).length} -> after ${far.filter((r) => r.nowVisible).length}`);
const band = far.filter((row) => isAnnouncedLongRange({
  startDate: row.start, endDate: row.end, nearTermHorizon: horizon, demandRadiusKm: scope.demandRadiusKm,
  hasConfirmedDateAndLocation: row.confirmed,
  scores: [{ importance: row.afterImp, impactBasis: row.afterBasis, distanceKm: row.distanceKm, assessment: row.assessment }],
}));
console.log(`\nannounced band (beyond horizon, assessed, not already visible): ${band.length}`);
for (const row of band.sort((a, b) => b.after - a.after)) console.log(`   ${String(row.after).padStart(3)}/${row.afterImp.padEnd(6)} ${row.start} ${row.title.slice(0, 52)}`);
await server.close();
