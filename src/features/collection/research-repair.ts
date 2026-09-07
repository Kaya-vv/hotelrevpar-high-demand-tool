import { hasDemandEvidence } from "../events/evidence";
import { eventLocalDate } from "../events/normalize";
import type { EventCandidate } from "../events/types";
import type { Lead } from "./long-range-store";

export const REPAIR_VERSION = 1;

export function needsDemandResearch(event: EventCandidate) {
  return !hasDemandEvidence(event) || ((event.aiImpactPoints ?? 0) >= 45
    && !["national", "international"].includes(event.overnightAudience ?? "")
    && (event.attendance ?? 0) < 5_000 && (event.venueCapacity ?? 0) < 10_000);
}

/** Compatibility repair is independent from normal weekly monitoring. */
export function scheduleEvidenceRepair(lead: Lead, now: string, end: string) {
  if (lead.outcome === "conflict" || lead.repair?.version === REPAIR_VERSION) return;
  const incomplete = lead.editions.some((event) => eventLocalDate(event.endAt) >= now.slice(0, 10)
    && eventLocalDate(event.startAt) <= end
    && Math.max(event.aiImpactPoints ?? 0, lead.historicalDemandPoints ?? 0) >= 45
    && (!event.evidence?.dateText || !event.evidence.locationText || !event.evidence.hostCity || needsDemandResearch(event)));
  if (incomplete) lead.repair = { version: REPAIR_VERSION, dueAt: lead.nextCheck < now ? lead.nextCheck : now };
}

export function repairPending(lead: Lead) {
  return Boolean(lead.repair && !lead.repair.attemptedAt);
}

export function researchDueAt(lead: Lead) {
  return repairPending(lead) ? lead.repair!.dueAt : lead.nextCheck;
}
