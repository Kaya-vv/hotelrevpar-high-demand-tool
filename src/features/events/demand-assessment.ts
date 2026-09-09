import { z } from "zod";
import { distanceKm } from "./distance";
import { eventLocalDate } from "./normalize";
import type { EventCandidate } from "./types";

export const demandAssessmentSchema = z.object({
  version: z.literal(1),
  relevance: z.enum(["supported", "probable", "unresolved", "not_relevant"]),
  magnitude: z.enum(["Low", "Medium", "High", "Peak"]).nullable(),
  confidence: z.enum(["high", "medium", "low"]),
  reasons: z.array(z.string()),
  sourceUrls: z.array(z.string()),
});
export type DemandAssessment = z.infer<typeof demandAssessmentSchema>;
export function readDemandAssessment(value: unknown) {
  const parsed = demandAssessmentSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
export function hasHotelDemand(value: DemandAssessment | undefined) {
  return value?.relevance === "supported" || value?.relevance === "probable";
}

/** Relevance is independent of audience size, distance points and other events. */
export function assessHotelDemand(candidate: EventCandidate, hotel?: {
  latitude: number; longitude: number; demandRadiusKm: number;
}): DemandAssessment {
  const assessment: DemandAssessment = { version: 1, relevance: "unresolved", magnitude: null,
    confidence: "low", reasons: [], sourceUrls: [] };
  const reject = (reason: string) => ({ ...assessment, relevance: "not_relevant" as const, reasons: [reason] });
  if (candidate.sourceState !== "active" || candidate.certainty !== "confirmed" || !candidate.primarySourceConfirmed)
    return reject("Datum of actuele status niet bevestigd.");
  if (/^(public_holiday|school_holiday)$/.test(candidate.category)) return reject("Kalendercontext, geen aangetoonde evenementvraag.");
  // Collection can evaluate evidence before geocoding; hotel publication must supply its scope.
  if (hotel) {
    if (candidate.latitude === null || candidate.longitude === null) return { ...assessment, reasons: ["Evenementlocatie ontbreekt."] };
    if (distanceKm(hotel.latitude, hotel.longitude, candidate.latitude, candidate.longitude) > hotel.demandRadiusKm)
      return reject("Buiten het ingestelde onderzoeksgebied.");
  }
  const evidence = candidate.evidence;
  const facts = evidence?.demand.filter((fact) => fact.comparable && fact.text && fact.sourceUrl
    && (fact.scope === "edition" || Boolean(fact.applicability)) && (fact.scope !== "historical" || fact.year !== null)) ?? [];
  if (!facts.length) return { ...assessment, reasons: ["Nog geen onderbouwde informatie over hotelvraag."] };
  const text = facts.map((fact) => fact.text).join("\n");
  const kinds = new Set(facts.flatMap((fact) => fact.kind ? [fact.kind] : []));
  const multiday = Boolean(evidence?.continuous) && eventLocalDate(candidate.endAt) > eventLocalDate(candidate.startAt)
    && !/exhibition|museum|musical|theat(?:er|re)|season/i.test(candidate.category);
  // Legacy quotes remain usable; names of international artists are not audience origins.
  const travellers = kinds.has("travelling_audience") || facts.some((fact) =>
    /(?:visitors?|bezoekers?|delegates?|deelnemers?|exhibitors?|exposanten?|fans|music lovers?|teams|swimmers|zwemmers).{0,100}(?:from .{0,25}countries|uit .{0,25}landen|travel(?:ling|ing| from)|around the (?:world|globe)|uit het buitenland)/i.test(fact.text));
  const hotelStay = facts.some(fact => fact.kind === "hotel_stay"
    && !/no hotel|no overnight|geen overnachting|geen hotel/i.test(fact.text)
    && (!/tent|camping/i.test(fact.text) || /hotel rooms|hotelkamers|hotel package/i.test(fact.text)));
  const competition = kinds.has("national_competition") || (evidence?.majorCompetition &&
    /kwalificatietoernooi|national championship|nationaal kampioenschap|swimmers chasing qualification/i.test(text));
  const internationalFixture = kinds.has("international_fixture");
  const destination = kinds.has("destination_event");
  const trade = kinds.has("trade_fair");
  const local = kinds.has("local_audience");
  if (local && !hotelStay && !travellers) return reject("Bron beschrijft hoofdzakelijk lokaal publiek zonder verblijfssignaal.");
  if (hotelStay) {
    assessment.relevance = facts.some(fact => fact.kind === "hotel_stay" && fact.scope === "edition") ? "supported" : "probable"; assessment.confidence = assessment.relevance === "supported" ? "high" : "medium";
    assessment.reasons.push("Evenementspecifieke hotelovernachtingen of kamerafspraken bevestigd.");
  } else if (travellers && (multiday || /concert|music|festival|sports/i.test(candidate.category))) {
    assessment.relevance = "probable"; assessment.confidence = "medium";
    assessment.reasons.push(multiday ? "Reizend publiek en een doorlopend meerdaags programma." : "Reizend publiek voor een eenmalig evenement; ook één avond kan hotelvraag veroorzaken.");
  } else if ((competition && multiday) || internationalFixture || (destination && multiday) || (trade && multiday)) {
    assessment.relevance = "probable"; assessment.confidence = "medium";
    assessment.reasons.push(internationalFixture ? "Internationale uitwedstrijd met reizende teams en supporters." : competition
      ? "Meerdaags bovenregionaal deelnemerstoernooi." : trade ? "Meerdaagse vakbeurs met aantoonbare exposantenreisvraag." : "Gevestigd bestemmingsfestival met vergelijkbare publieksgegevens.");
  }
  if (!hasHotelDemand(assessment)) assessment.reasons.push("Duur, zaalcapaciteit of artiestennaam bewijst geen hotelvraag.");
  assessment.sourceUrls = [...new Set(facts.map((fact) => fact.sourceUrl))];
  // Audience totals indicate event scale, not room nights. Capacity and AI points never grade demand.
  // Peak requires measured overnight volume; it cannot be inferred from a crowded festival.
  const quantities = facts.flatMap((fact) => fact.quantity ? [fact.quantity] : []);
  const rooms = Math.max(0, ...facts.filter(fact => fact.scope === "edition").flatMap(fact => fact.quantity ? [fact.quantity] : []).filter((q) => q.unit === "hotel_rooms" && q.period === "per_night").map((q) => q.value));
  const days = Math.max(1, Math.round((Date.parse(eventLocalDate(candidate.endAt)) - Date.parse(eventLocalDate(candidate.startAt))) / 86400000) + 1);
  const audience = Math.max(0, ...quantities.filter((q) => q.unit === "people")
    .map((q) => q.period === "whole_event" ? q.value / days : q.period === "per_day" ? q.value : 0));
  if (hasHotelDemand(assessment)) {
    assessment.magnitude = rooms >= 1000 ? "Peak" : rooms >= 100 || audience >= 5000 ? "High" : audience > 0 ? "Medium" : null;
  }
  return assessment;
}
