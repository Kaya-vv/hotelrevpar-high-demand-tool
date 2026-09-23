/** Broad long-range announcement search, the owner's venue agendas and the daily queueing of hotels. */
export const ANNOUNCEMENT_SEARCH_DAYS = 7;
/** Leads still being worked on, and the window a paid follow-up allowance covers. */
export const LEAD_RECHECK_DAYS = 30;
/** Leads whose edition is confirmed and fully assessed. */
export const CONFIRMED_RECHECK_DAYS = 90;
/** Near-term (next 90 days) search. */
export const NEAR_TERM_SEARCH_DAYS = 14;

/** Compare calendar days so a few minutes in the queue cannot add another day. */
export function searchDue(lastStartedAt: string | null, now: Date, days: number) {
  return !lastStartedAt || Date.parse(now.toISOString().slice(0, 10))
    - Date.parse(lastStartedAt.slice(0, 10)) >= days * 86_400_000;
}
