// Read-only preview of the "rooms per night" scoring rework against production evidence.
// Scores every active, non-archived hotel's events with today's scorer ("before") and with the
// proposed model ("after"). No writes, no provider calls.
// Usage: node scripts/scoring-rework-preview.mjs [hotelNameSubstring]
import { readFileSync, writeFileSync } from "node:fs";
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
const { scoreHotelEvent, importance } = await server.ssrLoadModule("/src/features/events/score.ts");
const { readEventEvidence } = await server.ssrLoadModule("/src/features/events/evidence.ts");
const { readEventSizeCheck } = await server.ssrLoadModule("/src/features/events/size-check.ts");
const { hasHotelDemand } = await server.ssrLoadModule("/src/features/events/demand-assessment.ts");
const { isPublishableDemand } = await server.ssrLoadModule("/src/features/events/importance.ts");
const { selectScoreEvidence } = await server.ssrLoadModule("/src/features/events/source-evidence.ts");
const { knownVenueCapacity, venueCrowdIsAudience } = await server.ssrLoadModule("/src/features/events/venues.ts");
const { eventLocalDate } = await server.ssrLoadModule("/src/features/events/normalize.ts");

// ---- Proposed model -------------------------------------------------------------------------
// rooms per night = visitors present per day x share that stays overnight.
// The calendar already marks every day of a multi-day event, so the number of nights decides how
// many days light up, not how bright each day is.
const congress = /congres|congress|conferen|symposi|summit|convention|annual meeting|assembly|forum/i;
const tradeFair = /trade|beurs|expo\b|exhibition|vakbeurs|show\b.*(industry|b2b)/i;
const championship = /kampioenschap|championship|\bwk\b|\bek\b|world cup|tournament|toernooi|qualif|kwalificatie|marathon/i;
const festival = /festival/i;
const family = /kinder|kids|family|familie|children|\(\d\+\)|sesamstraat|k3\b|disney on ice/i;
const performance = /music|muziek|concert|dance|comedy|cabaret|\bdj\b|show|musical|theat|circus|club|film/i;
const marquee = (category, title, regionScope = "") => category === "sports" && (
  /international|internationaal|european|europees/i.test(regionScope)
  || /champions league|europa league|conference league|wereldkampioenschap|world cup|\bwk\b|europees kampioenschap|\bek\b|finale/i.test(title)
  || ["ajax", "feyenoord", "psv"].filter((club) => title.toLowerCase().includes(club)).length >= 2);

const parseVisitors = (text) => {
  const match = /(\d{1,3}(?:[.,\s]\d{3})+|\d+)\s*(k|duizend)?/i.exec(text ?? "");
  if (!match) return null;
  const value = Number(match[1].replace(/[.,\s]/g, "")) * (match[2] ? 1000 : 1);
  return value >= 50 ? { value, daily: /per dag|per day|daily|dagelijks/i.test(text) } : null;
};
const aiBand = { 60: 20_000, 45: 7_500, 35: 3_000 };

// `measured` = a real visitor figure (stated by the source or known from earlier editions).
function visitors(candidate) {
  if (candidate.attendance) return { people: candidate.attendance, from: "opgegeven aantal", measured: true, perShow: false };
  const quoted = (candidate.evidence?.demand ?? []).flatMap((fact) => fact.quantity?.unit === "people" ? [fact.quantity] : [])
    .sort((a, b) => b.value - a.value)[0];
  if (quoted) return { people: quoted.value, from: "aantal uit bron", measured: true, perShow: quoted.period === "per_day" };
  const sized = candidate.sizeCheck?.verdict === "big" ? parseVisitors(candidate.sizeCheck.visitors) : null;
  if (sized) return { people: sized.value, from: "algemene kennis", measured: true, perShow: sized.daily };
  const hall = venueCrowdIsAudience(candidate.category, candidate.title, candidate.venue)
    ? (candidate.venueCapacity ?? knownVenueCapacity(candidate.venue)) : null;
  const stadium = marquee(candidate.category, candidate.title, candidate.regionScope) ? knownVenueCapacity(candidate.venue) : null;
  const ai = candidate.aiImpactPoints != null ? (aiBand[candidate.aiImpactPoints] ?? 800) : null;
  const options = [hall && { people: Math.round(hall * 0.8), from: "zaalgrootte x 0,8", perShow: true },
    stadium && { people: Math.round(stadium * 0.8), from: "stadion x 0,8", perShow: true },
    ai && { people: ai, from: `AI-inschatting ${candidate.aiImpactPoints}`, perShow: false }].filter(Boolean);
  return options.length ? { ...options.sort((a, b) => b.people - a.people)[0], measured: false } : null;
}

function overnightShare(candidate, days) {
  const text = `${candidate.category} ${candidate.title}`;
  const audience = candidate.overnightAudience;
  if (family.test(text)) return { share: 0.03, from: "soort: familievoorstelling" };
  if (audience === "international") return { share: 0.5, from: "internationaal publiek" };
  if (audience === "national") return { share: 0.3, from: "landelijk publiek" };
  if (audience === "regional") return { share: 0.08, from: "regionaal publiek" };
  if (audience === "none" || audience === "local") return { share: 0.02, from: "lokaal publiek" };
  const kinds = new Set((candidate.evidence?.demand ?? []).flatMap((fact) => fact.kind ? [fact.kind] : []));
  if (kinds.has("local_audience") && !kinds.has("travelling_audience") && !kinds.has("hotel_stay")) return { share: 0.02, from: "bron: lokaal publiek" };
  if (kinds.has("hotel_stay")) return { share: 0.4, from: "bron: hotelovernachtingen" };
  if (kinds.has("trade_fair") || kinds.has("national_competition")) return { share: 0.35, from: "bron: vakbeurs/kampioenschap" };
  if (kinds.has("travelling_audience")) return { share: 0.3, from: "bron: reizend publiek" };
  if (kinds.has("destination_event")) return { share: 0.25, from: "bron: bestemmingsevenement" };
  if (congress.test(text) || tradeFair.test(text)) return { share: 0.3, from: "soort: zakelijk" };
  // Away supporters (a few thousand) stay one night; home supporters travel back.
  if (marquee(candidate.category, candidate.title, candidate.regionScope)) return { share: 0.06, from: "soort: Europese wedstrijd" };
  if (championship.test(text)) return { share: 0.25, from: "soort: kampioenschap" };
  if (festival.test(text) && days >= 2) return { share: 0.2, from: "soort: meerdaags festival" };
  if (/concert|music|muziek|dance|\bdj\b/i.test(text)) return { share: 0.08, from: "soort: concert" };
  if (performance.test(text)) return { share: 0.03, from: "soort: voorstelling" };
  return { share: 0.05, from: "standaard" };
}

// A congress has the same delegates every day; a trade fair partly; a festival mostly new visitors.
function presentPerDay(candidate, crowd, days) {
  if (crowd.perShow || days <= 1) return crowd.people;
  const text = `${candidate.category} ${candidate.title}`;
  if (congress.test(text)) return crowd.people;
  if (tradeFair.test(text)) return Math.round(crowd.people / ((days + 1) / 2));
  return Math.round(crowd.people / days);
}

const roomsBand = [[4000, 70], [2000, 60], [800, 50], [300, 40], [100, 30], [30, 20]];

function proposedScore(candidate, current, overlapBonus, radiusKm) {
  if (/^(public_holiday|school_holiday)$/.test(candidate.category)) return { ...current, rooms: null };
  const crowd = visitors(candidate);
  // Nothing known about size: keep today's score rather than pretend.
  if (!crowd) return { ...current, rooms: null };
  const start = eventLocalDate(candidate.startAt);
  const end = eventLocalDate(candidate.endAt);
  const days = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
  const continuous = candidate.evidence?.continuous ?? (days > 1 && !/musical|theat|voorstelling/i.test(candidate.category));
  const stay = overnightShare(candidate, days);
  const daily = presentPerDay(candidate, crowd, days);
  const rooms = Math.round(daily * stay.share);
  const impact = (roomsBand.find(([floor]) => rooms >= floor) ?? [0, 10])[1];
  const longStay = continuous && days > 1 && stay.share >= 0.2 ? 5 : 0;
  let total = Math.min(100, impact + current.distancePoints + overlapBonus + longStay);
  // Same guards as today: routine league fixtures, sources arguing against demand, and events
  // outside the radius or without a location never reach High.
  const routineSport = candidate.category === "sports" && !marquee(candidate.category, candidate.title, candidate.regionScope);
  const outside = current.distanceKm === null || current.distanceKm > radiusKm;
  if (routineSport || outside || current.assessment.relevance === "not_relevant") total = Math.min(69, total);
  if (candidate.sizeCheck?.verdict === "small" && !hasHotelDemand(current.assessment)) total = Math.min(69, total);
  // Peak needs a real visitor figure; hall size or a model guess alone stops at High.
  if (!crowd.measured) total = Math.min(84, total);
  // Quoted hotel-room evidence keeps its own scale, as today.
  if (current.impactBasis === "demand_rule" && current.total > total) total = current.total;
  return { total, suggestedImportance: importance(total), impactBasis: "hotel_rooms", rooms, daily, crowd, stay };
}

// ---- Variant B: targeted fixes on top of today's scorer -------------------------------------
function targetedScore(candidate, current, full, radiusKm) {
  let total = current.total;
  const text = `${candidate.category} ${candidate.title}`;
  // Hall size is a ceiling, not an audience: on its own it gives at most High. This can only take
  // a Peak down to High (84); nothing that is High or Peak today can fall to Medium.
  if (current.impactBasis === "venue_capacity") total = Math.min(84, total);
  // A real visitor figure with a travelling audience lifts a stay-generating event. Peak only for
  // multi-day runs, business events and championships/marathons: a single concert's "international"
  // label usually describes the artist, not the audience.
  const eligible = full.crowd?.measured && full.rooms != null && full.stay.share >= 0.3
    && current.assessment.relevance !== "not_relevant" && current.distanceKm !== null && current.distanceKm <= radiusKm
    && !(candidate.category === "sports" && !marquee(candidate.category, candidate.title, candidate.regionScope));
  const days = Math.round((Date.parse(eventLocalDate(candidate.endAt)) - Date.parse(eventLocalDate(candidate.startAt))) / 86_400_000) + 1;
  const stayKind = (days > 1 && (candidate.evidence?.continuous ?? true)) || congress.test(text) || tradeFair.test(text) || championship.test(text);
  if (eligible && stayKind && full.rooms >= 2000) total = Math.max(total, 85);
  else if (eligible && full.rooms >= 800) total = Math.max(total, 75);
  return { ...full, total, suggestedImportance: importance(total), impactBasis: total === current.total ? current.impactBasis : "targeted" };
}

// ---- Data ------------------------------------------------------------------------------------
const filter = process.argv[2]?.toLowerCase();
const hotels = (await api("hotels?archived_at=is.null&select=id,name,account_id,latitude,longitude,demand_radius_km,holiday_region"))
  .filter((hotel) => !filter || hotel.name.toLowerCase().includes(filter));
const rows = [];
for (const hotel of hotels) {
  const [area] = await api(`collection_areas?hotel_id=eq.${hotel.id}&select=id,enabled_sources`);
  if (!area) continue;
  const scope = { latitude: hotel.latitude, longitude: hotel.longitude, demandRadiusKm: hotel.demand_radius_km, holidayRegion: hotel.holiday_region };
  const links = await api(`account_event_areas?collection_area_id=eq.${area.id}&select=event_id`);
  const linked = [...new Set(links.map((link) => link.event_id))];
  const decisions = await batched(linked, (ids) => `account_events?account_id=eq.${hotel.account_id}&state=eq.active&event_id=in.(${ids})&select=event_id`);
  const ids = decisions.map((decision) => decision.event_id);
  const events = await batched(ids, (list) => `events?id=in.(${list})&certainty=eq.confirmed&end_at=gte.${new Date().toISOString().slice(0, 10)}&select=*`);
  const sources = await batched(events.map((event) => event.id), (list) => `event_sources?event_id=in.(${list})&select=*`);
  const candidates = events.flatMap((event) => {
    const evidence = selectScoreEvidence(sources.filter((source) => source.event_id === event.id), area.enabled_sources);
    if (!evidence) return [];
    return [{ event, candidate: {
      evidence: readEventEvidence(evidence.evidence), provider: evidence.provider, providerEventId: evidence.provider_event_id,
      sourceUrl: evidence.source_url, publicSourceUrl: evidence.public_source_url, title: event.title, category: event.category,
      venue: event.venue, latitude: event.latitude, longitude: event.longitude, regionScope: event.region_scope,
      startAt: event.start_at, endAt: event.end_at, sourceState: evidence.source_state, certainty: event.certainty,
      localRank: evidence.local_rank, attendance: evidence.attendance, venueCapacity: evidence.venue_capacity,
      aiImpactPoints: evidence.ai_impact_points, overnightAudience: evidence.overnight_audience,
      evidenceText: evidence.evidence_text, primarySourceConfirmed: evidence.primary_source_confirmed,
      sizeCheck: readEventSizeCheck(event.size_check),
    } }];
  });
  const bases = new Map(candidates.map(({ event, candidate }) => [event.id, scoreHotelEvent({ candidate, hotel: scope, overlaps: [] })]));
  for (const { event, candidate } of candidates) {
    const overlaps = candidates.filter((other) => other.event.id !== event.id).map((other) => ({
      startAt: other.candidate.startAt, endAt: other.candidate.endAt, preOverlapTotal: bases.get(other.event.id)?.total ?? 0 }));
    const before = scoreHotelEvent({ candidate, hotel: scope, overlaps });
    const full = proposedScore(candidate, before, Math.max(0, before.stayPressurePoints - bases.get(event.id).stayPressurePoints), hotel.demand_radius_km);
    const targeted = targetedScore(candidate, before, full, hotel.demand_radius_km);
    rows.push({ hotel: hotel.name, title: event.title, category: event.category, start: eventLocalDate(event.start_at), before, full, targeted });
  }
}

// ---- Report ----------------------------------------------------------------------------------
const shown = (score) => isPublishableDemand(score.suggestedImportance, score.impactBasis === "targeted" || score.impactBasis === "hotel_rooms" ? "ai_assessment" : score.impactBasis);
const tally = (key) => rows.reduce((acc, row) => { acc[row[key].suggestedImportance] = (acc[row[key].suggestedImportance] ?? 0) + 1; return acc; }, {});
const unique = (list) => [...new Map(list.map((row) => [row.title, row])).values()];
const levels = ["Low", "Medium", "High", "Peak"];
const fmt = (row, key) => `${row.before.total}/${row.before.suggestedImportance} -> ${row[key].total}/${row[key].suggestedImportance}  ${row.title.slice(0, 46)}  [${row.full.crowd ? `${row.full.crowd.people} bez. (${row.full.crowd.from}) -> ${row.full.daily}/dag x ${row.full.stay.share} (${row.full.stay.from}) = ${row.full.rooms} kamers/nacht` : "geen omvang bekend"}]`;
writeFileSync("out/scoring-rework-preview.json", JSON.stringify(rows.map((row) => ({ hotel: row.hotel, title: row.title, category: row.category, start: row.start,
  before: { total: row.before.total, level: row.before.suggestedImportance, basis: row.before.impactBasis },
  full: { total: row.full.total, level: row.full.suggestedImportance, rooms: row.full.rooms, perDay: row.full.daily, visitors: row.full.crowd, share: row.full.stay },
  targeted: { total: row.targeted.total, level: row.targeted.suggestedImportance } })), null, 1));
console.log(`${hotels.length} hotels, ${rows.length} hotel-event pairs\nbefore:   ${JSON.stringify(tally("before"))}\nA full:   ${JSON.stringify(tally("full"))}\nB target: ${JSON.stringify(tally("targeted"))}`);
console.log("\n== Per hotel: High+Peak shown (of which Peak)   before | A full model | B targeted ==");
for (const name of [...new Set(rows.map((row) => row.hotel))]) {
  const mine = rows.filter((row) => row.hotel === name);
  const cell = (key) => `${String(mine.filter((row) => shown(row[key])).length).padStart(3)} (${String(mine.filter((row) => row[key].suggestedImportance === "Peak").length).padStart(2)})`;
  console.log(`  ${name.padEnd(42)} ${cell("before")} | ${cell("full")} | ${cell("targeted")}`);
}
for (const key of ["targeted"]) {
  console.log(`\n== ${key}: level changes (unique events) ==`);
  for (const row of unique(rows.filter((row) => row[key].suggestedImportance !== row.before.suggestedImportance))
    .sort((a, b) => levels.indexOf(b[key].suggestedImportance) - levels.indexOf(a[key].suggestedImportance) || b[key].total - a[key].total)) console.log("  " + fmt(row, key));
}
const fellBelowHigh = rows.filter((row) => ["High", "Peak"].includes(row.before.suggestedImportance) && !["High", "Peak"].includes(row.targeted.suggestedImportance));
const anyDrop = rows.filter((row) => row.targeted.total < row.before.total);
console.log(`\n== Regression check (B) ==\n  High/Peak today that fall below High: ${fellBelowHigh.length}\n  hotel-event pairs scoring lower at all: ${anyDrop.length}`);
for (const row of unique(anyDrop)) console.log(`    ${row.before.total}/${row.before.suggestedImportance} -> ${row.targeted.total}/${row.targeted.suggestedImportance}  ${row.title.slice(0, 50)}  (reden: ${row.before.impactBasis})`);
const named = /breakbulk|bassie|champions league|north sea|marathon|europort|iffr|film festival rotterdam|state of trance|c2c|holiday on ice|dutch design week|horecava|glow|wk turnen|era congress|oasis|j\. cole|korfball|intermodal|infratech/i;
console.log("\n== Named events: before | A full | B targeted ==");
for (const row of unique(rows.filter((row) => named.test(row.title))).sort((a, b) => b.targeted.total - a.targeted.total))
  console.log(`  ${`${row.before.total}/${row.before.suggestedImportance}`.padEnd(10)} | ${`${row.full.total}/${row.full.suggestedImportance}`.padEnd(10)} | ${`${row.targeted.total}/${row.targeted.suggestedImportance}`.padEnd(10)} ${row.title.slice(0, 50)}`);
await server.close();
