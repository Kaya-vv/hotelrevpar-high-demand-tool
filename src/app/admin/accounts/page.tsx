import { requirePlatformAdmin } from "@/lib/auth/require-account";
import { createAdminClient } from "@/lib/supabase/admin";

import { createSubscriberAccount, disableAccount } from "./actions";

export default async function AccountsPage() {
  await requirePlatformAdmin();
  const { data: accounts, error } = await createAdminClient()
    .from("accounts")
    .select("id, name, active, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;

  return (
    <main className="admin-page">
      <header className="page-title">
        <span className="eyebrow">Platformbeheer</span>
        <h1>Abonnees</h1>
      </header>
      <section className="panel">
        <h2>Account aanmaken</h2>
        <form action={createSubscriberAccount} className="inline-form">
          <label>
            Accountnaam
            <input name="accountName" required />
          </label>
          <label>
            E-mailadres
            <input name="email" type="email" required />
          </label>
          <button className="primary" type="submit">Uitnodigen</button>
        </form>
      </section>
      <section className="panel">
        <h2>Bestaande accounts</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Naam</th><th>Status</th><th /></tr></thead>
            <tbody>
              {accounts?.map((account) => (
                <tr key={account.id}>
                  <td>{account.name}</td>
                  <td>{account.active ? "Actief" : "Uitgeschakeld"}</td>
                  <td>
                    {account.active && (
                      <form action={disableAccount}>
                        <input type="hidden" name="accountId" value={account.id} />
                        <button className="secondary" type="submit">Uitschakelen</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

