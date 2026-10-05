import { renderTrialReminder } from "@/features/billing/trial-email";
import { runTrialLifecycle, type TrialLifecycleDependencies } from "@/features/billing/trial-lifecycle";
import { postEventNotification } from "@/features/notifications/service";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export function createTrialsCronHandler(secret: string | undefined, dependencies: () => TrialLifecycleDependencies) {
  return async (request: Request) => {
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    return Response.json(await runTrialLifecycle(dependencies()));
  };
}

export async function GET(request: Request) {
  return createTrialsCronHandler(process.env.CRON_SECRET, () => {
    // The cron has no login session, so it reads and writes with the service role.
    const admin = createAdminClient();
    return {
      listTrialAccounts: async () => {
        const { data, error } = await admin.from("accounts")
          .select("id, name, trial_ends_at, trial_reminder_sent_at")
          .eq("active", true)
          .not("trial_ends_at", "is", null);
        if (error) throw error;
        return data.flatMap((account) => account.trial_ends_at
          ? [{ id: account.id, name: account.name, trialEndsAt: account.trial_ends_at, reminderSentAt: account.trial_reminder_sent_at }]
          : []);
      },
      deactivate: async (accountId, now) => {
        // The trial conditions live in the write itself, so a purchase that cleared trial_ends_at
        // after the list was read is never undone here.
        const { data, error } = await admin.from("accounts").update({ active: false })
          .eq("id", accountId)
          .not("trial_ends_at", "is", null)
          .lte("trial_ends_at", now.toISOString())
          .select("id");
        if (error) throw error;
        return data.length > 0;
      },
      listMemberEmails: async (accountId) => {
        const { data, error } = await admin.from("account_members").select("user_id").eq("account_id", accountId);
        if (error) throw error;
        const emails = await Promise.all(data.map(async (member) => {
          const user = await admin.auth.admin.getUserById(member.user_id);
          if (user.error) throw user.error;
          return user.data.user.email ?? null;
        }));
        return emails.filter((email): email is string => Boolean(email));
      },
      sendReminder: async ({ accountId, accountName, email, endsAt }) => {
        const apiKey = process.env.RESEND_API_KEY;
        const from = process.env.RESEND_FROM_EMAIL;
        if (!apiKey || !from) throw new Error("Resend is niet geconfigureerd.");
        // Not gated by EVENT_NOTIFICATIONS_ENABLED: that switch is for the new-event e-mail, and a
        // customer must hear that their trial ends either way.
        const message = renderTrialReminder({
          accountName,
          endsAt,
          siteUrl: process.env.NEXT_PUBLIC_SITE_URL!,
          checkoutUrl: process.env.PLUGANDPAY_CHECKOUT_URL || null,
        });
        const result = await postEventNotification({
          id: accountId,
          recipientEmail: email,
          ...message,
          idempotencyKey: `demandradar/trial-reminder/${accountId}/${email}`,
        }, {
          apiKey,
          from,
          ...(process.env.RESEND_REPLY_TO_EMAIL ? { replyTo: process.env.RESEND_REPLY_TO_EMAIL } : {}),
        });
        if (!result.accepted) throw new Error(`Resend weigerde de herinnering (${result.status}).`);
      },
      markReminded: async (accountId) => {
        const { error } = await admin.from("accounts")
          .update({ trial_reminder_sent_at: new Date().toISOString() }).eq("id", accountId);
        if (error) throw error;
      },
    };
  })(request);
}
