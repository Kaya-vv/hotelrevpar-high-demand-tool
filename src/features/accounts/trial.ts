import { nearTermHorizonEnd } from "@/features/collection/schedule";

export const TRIAL_DAYS = 30;
export const TRIAL_HOTEL_LIMIT = 1;
export const TRIAL_REMINDER_DAYS = 7;

/** When a trial that starts now must end, as an ISO timestamp. */
export function trialEndsOn(now = new Date()) {
  return new Date(now.getTime() + TRIAL_DAYS * 86_400_000).toISOString();
}

/**
 * The last date this account may see, or null when it has no cap. A trial only buys the
 * near-term search, so it sees exactly what that search covers.
 */
export function trialHorizonEnd(trialEndsAt: string | null | undefined, now = new Date()) {
  return trialEndsAt ? nearTermHorizonEnd(now) : null;
}

/**
 * Database filter that passes paid accounts and trials that have not run out yet. Checked
 * wherever work starts, so an ended trial gets nothing even before the daily switch-off.
 */
export function unexpiredTrialFilter(now = new Date()) {
  return `trial_ends_at.is.null,trial_ends_at.gt.${now.toISOString()}`;
}

export function trialDaysLeft(trialEndsAt: string, now = new Date()) {
  return Math.max(0, Math.ceil((Date.parse(trialEndsAt) - now.getTime()) / 86_400_000));
}

export function trialExpired(trialEndsAt: string, now = new Date()) {
  return Date.parse(trialEndsAt) <= now.getTime();
}

export function trialReminderDue(trialEndsAt: string, reminderSentAt: string | null, now = new Date()) {
  if (reminderSentAt) return false;
  const end = Date.parse(trialEndsAt);
  return end > now.getTime() && end <= now.getTime() + TRIAL_REMINDER_DAYS * 86_400_000;
}
