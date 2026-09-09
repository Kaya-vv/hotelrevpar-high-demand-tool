// What the 2026-09-08 Utrecht run (bdb54f66) would have scored if the collector had not discarded
// the model's own demand judgement. Read-only: no writes, no provider calls.
//
// This is a COUNTERFACTUAL, not a replay. A faithful replay is impossible: that run's model
// outputs were never persisted, because the very gating under test nulled them before the insert.
// Two facts bound the discarded values:
//   1. `ai_impact_points` is null on all 28 stored rows, yet the code that ran it dropped any
//      active candidate whose impactPoints was not 35, 45 or 60 ("Geen aantoonbare hotelvraag"),
//      and none of the run's 30 funnel drops carries that reason. So every persisted candidate
//      had impactPoints in {35, 45, 60}.
//   2. `overnight_audience` was nulled by the same gate and cannot be recovered at all, so it is
//      swept across null / regional / national / international.
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
const { scoreHotelEvent } = await server.ssrLoadModule("/src/features/events/score.ts");
const { readEventEvidence } = await server.ssrLoadModule("/src/features/events/evidence.ts");
const { isPublishableDemand } = await server.ssrLoadModule("/src/features/events/importance.ts");
const { selectScoreEvidence } = await server.ssrLoadModule("/src/features/events/source-evidence.ts");

const AREA = "2e41b858-7902-4f2e-b3bd-14690a5f15d3";
const [area] = await api(`collection_areas?id=eq.${AREA}&select=id,account_id,hotel_id,enabled_sources`);
const [hotel] = await api(`hotels?id=eq.${area.hotel_id}&select=latitude,longitude,demand_radius_km,holiday_region`);
const scope = { latitude: hotel.latitude, longitude: hotel.longitude, demandRadiusKm: hotel.demand_radius_km, holidayRegion: hotel.holiday_region };

const links = await api(`account_event_areas?collection_area_id=eq.${AREA}&select=event_id`);
const linkedIds = [...new Set(links.map((link) => link.event_id))];
const decisions = await batched(linkedIds, (ids) => `account_events?account_id=eq.${area.account_id}&state=eq.active&event_id=in.(${ids})&select=event_id`);
const activeIds = decisions.map((decision) => decision.event_id);
const events = await batched(activeIds, (ids) => `events?id=in.(${ids})&select=*`);
const sources = await batched(activeIds, (ids) => `event_sources?event_id=in.(${ids})&select=*`);

const build = (event, evidence, injected) => ({
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
  evidenceText: evidence.evidence_text, primarySourceConfirmed: evidence.primary_source_confirmed,
  // Only these two fields differ from what is stored; the gate nulled exactly these.
  aiImpactPoints: evidence.provider === "claude" ? injected.points : evidence.ai_impact_points,
  overnightAudience: evidence.provider === "claude" ? injected.audience : evidence.overnight_audience,
});

function run(injected) {
  const candidates = events.flatMap((event) => {
    const evidence = selectScoreEvidence(sources.filter((source) => source.event_id === event.id), area.enabled_sources);
    return evidence ? [{ eventId: event.id, event, candidate: build(event, evidence, injected) }] : [];
  });
  // Two passes, as the repository does: bases without overlaps, then stay pressure against them.
  const bases = new Map(candidates.map(({ eventId, candidate }) => [eventId, scoreHotelEvent({ candidate, hotel: scope, overlaps: [] })]));
  return candidates.map(({ eventId, event, candidate }) => {
    const overlaps = candidates.filter((other) => other.eventId !== eventId).map((other) => ({
      startAt: other.candidate.startAt, endAt: other.candidate.endAt, preOverlapTotal: bases.get(other.eventId)?.total ?? 0,
    }));
    const score = scoreHotelEvent({ candidate, hotel: scope, overlaps });
    return { title: event.title, start: event.start_at.slice(0, 10), provider: candidate.provider,
      total: score.total, importance: score.suggestedImportance, basis: score.impactBasis,
      visible: isPublishableDemand(score.suggestedImportance, score.impactBasis) };
  });
}

console.log(`Test utrecht — ${activeIds.length} active linked events, run bdb54f66 evidence as stored\n`);
console.log("Stored today (both fields null, exactly what the run wrote):");
const asStored = run({ points: null, audience: null });
console.log(`  publishable: ${asStored.filter((row) => row.visible).length}\n`);

console.log("Counterfactual with the discarded model judgement preserved:");
console.log("  points  audience        publishable");
const grid = [];
for (const points of [35, 45, 60]) {
  for (const audience of [null, "regional", "national", "international"]) {
    const rows = run({ points, audience });
    const visible = rows.filter((row) => row.visible);
    grid.push({ points, audience, visible });
    console.log(`  ${String(points).padStart(6)}  ${String(audience ?? "null").padEnd(14)}  ${visible.length}`);
  }
}
const best = grid.find((cell) => cell.points === 45 && cell.audience === "national");
console.log(`\nEvents that become publishable at the mid value (45, national):`);
for (const row of best.visible.sort((a, b) => b.total - a.total))
  console.log(`  ${String(row.total).padStart(3)}/${row.importance.padEnd(4)} ${row.basis.padEnd(14)} ${row.start} ${row.title.slice(0, 52)}`);
await server.close();
