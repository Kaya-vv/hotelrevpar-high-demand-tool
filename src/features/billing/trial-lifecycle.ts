import { trialExpired, trialReminderDue } from "@/features/accounts/trial";

export type TrialAccount = { id: string; name: string; trialEndsAt: string; reminderSentAt: string | null };

export type TrialLifecycleDependencies = {
  now?: Date;
  /** Active accounts whose trial_ends_at is not null. */
  listTrialAccounts: () => Promise<TrialAccount[]>;
  /**
   * Switches the account off only if it is still a trial that ended by `now`, checked in the same
   * database write: someone who paid after `listTrialAccounts` ran must stay on. True when this
   * call switched it off.
   */
  deactivate: (accountId: string, now: Date) => Promise<boolean>;
  listMemberEmails: (accountId: string) => Promise<string[]>;
  sendReminder: (input: { accountId: string; accountName: string; email: string; endsAt: string }) => Promise<void>;
  markReminded: (accountId: string) => Promise<void>;
};

/** Switches off ended trials and sends the one reminder a week before the end. */
export async function runTrialLifecycle(
  dependencies: TrialLifecycleDependencies,
): Promise<{ expired: number; reminded: number; failed: number }> {
  const now = dependencies.now ?? new Date();
  const result = { expired: 0, reminded: 0, failed: 0 };
  for (const account of await dependencies.listTrialAccounts()) {
    // One account failing must never stop the others.
    try {
      if (trialExpired(account.trialEndsAt, now)) {
        if (await dependencies.deactivate(account.id, now)) result.expired += 1;
        continue;
      }
      if (!trialReminderDue(account.trialEndsAt, account.reminderSentAt, now)) continue;
      const emails = await dependencies.listMemberEmails(account.id);
      for (const email of emails) {
        await dependencies.sendReminder({ accountId: account.id, accountName: account.name, email, endsAt: account.trialEndsAt });
      }
      // An account without a login can never receive it; marking it stops a daily retry.
      await dependencies.markReminded(account.id);
      if (emails.length) result.reminded += 1;
    } catch (error) {
      // Not marked, so tomorrow's run tries again. The send key per account and address keeps
      // a member who already got it from receiving a second copy.
      result.failed += 1;
      console.error("Trial lifecycle failed for account", {
        accountId: account.id,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  return result;
}
