import { requireAccount } from "@/lib/auth/require-account";
import { createServerClient } from "@/lib/supabase/server";

import { logout, updateEventNotifications } from "./actions";

export default async function AccountPage() {
  const account = await requireAccount();
  const { data: membership, error } = await (await createServerClient())
    .from("account_members")
    .select("event_notifications_enabled")
    .eq("account_id", account.accountId)
    .eq("user_id", account.userId)
    .single();
  if (error) throw error;
  return (
    <div>
      <header className="page-title"><span className="eyebrow">Account</span><h1>{account.accountName}</h1></header>
      <section className="panel account-panel">
        <p><strong>Rol</strong><br />{account.role === "platform_admin" ? "Platformbeheerder" : "Operator"}</p>
        <form action={updateEventNotifications}>
          <label>
            <input
              type="checkbox"
              name="enabled"
              value="true"
              defaultChecked={membership.event_notifications_enabled}
            />{" "}
            E-mail bij nieuwe events
          </label>
          <p className="muted">Je ontvangt per hotel één overzicht wanneer nieuwe events aan de kalender zijn toegevoegd.</p>
          <button className="secondary" type="submit">Voorkeur opslaan</button>
        </form>
        <form action={logout}><button className="secondary" type="submit">Uitloggen</button></form>
      </section>
    </div>
  );
}

