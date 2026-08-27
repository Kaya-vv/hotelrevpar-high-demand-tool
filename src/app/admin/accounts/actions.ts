"use server";

import { revalidatePath } from "next/cache";

import { provisionSubscriber } from "@/features/accounts/provision-subscriber";
import { requirePlatformAdmin } from "@/lib/auth/require-account";
import { createAdminClient } from "@/lib/supabase/admin";

export async function createSubscriberAccount(formData: FormData) {
  await requirePlatformAdmin();
  const accountName = String(formData.get("accountName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!accountName || !email) throw new Error("Accountnaam en e-mailadres zijn verplicht.");
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) throw new Error("NEXT_PUBLIC_SITE_URL ontbreekt.");

  const admin = createAdminClient();
  await provisionSubscriber(
    { accountName, email },
    {
      inviteUser: async (inviteEmail) => {
        const redirectTo = new URL("/auth/confirm?next=/auth/set-password", siteUrl).toString();
        const { data, error } = await admin.auth.admin.inviteUserByEmail(inviteEmail, { redirectTo });
        if (error || !data.user) throw error ?? new Error("De uitnodiging is mislukt.");
        return data.user.id;
      },
      createAccount: async ({ accountName: name, userId }) => {
        const { data: account, error: accountError } = await admin
          .from("accounts")
          .insert({ name })
          .select("id")
          .single();
        if (accountError) throw accountError;

        const { error: memberError } = await admin
          .from("account_members")
          .insert({ account_id: account.id, user_id: userId });
        if (memberError) {
          await admin.from("accounts").delete().eq("id", account.id);
          throw memberError;
        }
      },
      removeUser: async (userId) => {
        const { error } = await admin.auth.admin.deleteUser(userId);
        if (error) throw error;
      },
    },
  );

  revalidatePath("/admin/accounts");
}

export async function disableAccount(formData: FormData) {
  await requirePlatformAdmin();
  const accountId = String(formData.get("accountId") ?? "");
  if (!accountId) throw new Error("Account ontbreekt.");

  const { error } = await createAdminClient().from("accounts").update({ active: false }).eq("id", accountId);
  if (error) throw error;
  revalidatePath("/admin/accounts");
}
