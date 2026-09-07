import type { LongRangeState } from "./long-range-store";

/** A run that queued research completes only once its market has been published. */
export function researchIsPending(requested: boolean, startedAt: string, state?: Pick<LongRangeState, "publishedAt" | "publicationPending" | "research"> | null) {
  if (!requested) return false;
  if (!state?.publishedAt || Date.parse(state.publishedAt) < Date.parse(startedAt)) return true;
  // A later refresh must not reopen an already-published historical run.
  return Boolean(state.publicationPending && (!state.research?.requestedAt || Date.parse(state.research.requestedAt) <= Date.parse(startedAt)));
}
