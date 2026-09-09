import { assessHotelDemand } from "../events/demand-assessment";
import { eventLocalDate } from "../events/normalize";
import type { EventCandidate } from "../events/types";
import type { Lead } from "./long-range-store";
import { CLAUDE_ASSESSMENT_VERSION } from "./anthropic-batches";

export const REPAIR_VERSION = 2;

export function needsDemandResearch(event: EventCandidate) {
  if (event.sourceState !== "active") return false;
  // Location resolution has its own stage and runs after extraction. Assess only
  // the demand facts here, so a missing geocode does not trigger paid research.
  return assessHotelDemand(event).relevance === "unresolved";
}

/** Compatibility repair is independent from normal weekly monitoring. */
export function scheduleEvidenceRepair(lead: Lead, now: string, end: string) {
  if (lead.outcome === "conflict" || lead.repair?.version === REPAIR_VERSION) return;
  const incomplete = lead.editions.some((event) => eventLocalDate(event.endAt) >= now.slice(0, 10)
    && eventLocalDate(event.startAt) <= end
    && event.sourceState === "active"
    && event.assessmentVersion !== CLAUDE_ASSESSMENT_VERSION
    && (!event.evidence?.dateText || !event.evidence.locationText || !event.evidence.hostCity || needsDemandResearch(event)));
  if (incomplete) lead.repair = { version: REPAIR_VERSION, dueAt: lead.nextCheck < now ? lead.nextCheck : now };
}

export function repairPending(lead: Lead) {
  return Boolean(lead.repair && !lead.repair.attemptedAt);
}

export function researchDueAt(lead: Lead) {
  return repairPending(lead) ? lead.repair!.dueAt : lead.nextCheck;
}
