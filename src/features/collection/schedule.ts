export const CHECK_INTERVAL_DAYS = 14;
export const BROAD_SEARCH_INTERVAL_DAYS = 28;

/** Compare calendar days so a few minutes in the queue cannot add another day. */
export function searchDue(lastStartedAt: string | null, now = new Date(), days = CHECK_INTERVAL_DAYS) {
  return !lastStartedAt || Date.parse(now.toISOString().slice(0, 10))
    - Date.parse(lastStartedAt.slice(0, 10)) >= days * 86_400_000;
}
