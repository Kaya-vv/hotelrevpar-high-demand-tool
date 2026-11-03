import { SubmitButton } from "@/components/submit-button";
import { requireAccount } from "@/lib/auth/require-account";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

import { logout, revokeApiKey, updateEventNotifications } from "./actions";
import { ApiKeyForm } from "./api-key-form";

const date = (value: string) => new Date(value).toLocaleDateString("nl-NL");

export default async function AccountPage() {
  const account = await requireAccount();
  const { data: membership, error } = await (await createServerClient())
    .from("account_members")
    .select("event_notifications_enabled")
    .eq("account_id", account.accountId)
    .eq("user_id", account.userId)
    .single();
  if (error) throw error;
  const { data: apiKeys, error: keyError } = await createAdminClient().from("api_keys")
    .select("id, name, key_prefix, created_at, last_used_at")
    .eq("account_id", account.accountId).is("revoked_at", null).order("created_at");
  if (keyError) throw keyError;
  return (
    <div>
      <header className="page-title"><span className="eyebrow">Account</span><h1>{account.accountName}</h1></header>
      <section className="panel account-panel">
        <p><strong>Rol</strong><br />{account.role === "platform_admin" ? "Platformbeheerder" : "Operator"}</p>
        <form action={updateEventNotifications}>
          <label className="account-toggle">
            <input
              type="checkbox"
              name="enabled"
              value="true"
              defaultChecked={membership.event_notifications_enabled}
            />
            E-mail bij nieuwe events
          </label>
          <p className="muted">Je ontvangt per hotel één overzicht wanneer nieuwe events aan de kalender zijn toegevoegd.</p>
          <button className="secondary" type="submit">Voorkeur opslaan</button>
        </form>
        <form action={logout}><button className="secondary" type="submit">Uitloggen</button></form>
      </section>
      <section className="panel account-panel">
        <h2>API-koppelingen</h2>
        <p className="muted">Met een API-sleutel kan een revenue management systeem, zoals RevControl, je events automatisch ophalen. Geef een sleutel alleen aan systemen die je vertrouwt.</p>
        <ApiKeyForm />
        {apiKeys.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Naam</th><th>Sleutel</th><th>Aangemaakt</th><th>Laatst gebruikt</th><th /></tr></thead>
              <tbody>
                {apiKeys.map((key) => (
                  <tr key={key.id}>
                    <td>{key.name}</td>
                    <td><code>{key.key_prefix}…</code></td>
                    <td>{date(key.created_at)}</td>
                    <td>{key.last_used_at ? date(key.last_used_at) : "Nog niet"}</td>
                    <td>
                      <form action={revokeApiKey}>
                        <input type="hidden" name="id" value={key.id} />
                        <SubmitButton confirmation="Weet je zeker dat je deze sleutel wilt intrekken? Systemen die hem gebruiken krijgen daarna geen events meer.">Intrekken</SubmitButton>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">Nog geen API-sleutels.</p>}
      </section>
    </div>
  );
}

