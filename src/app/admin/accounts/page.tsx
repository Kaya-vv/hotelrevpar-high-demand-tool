import { requirePlatformAdmin } from "@/lib/auth/require-account";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/supabase/fetch-in-batches";

import { createSubscriberAccount, deleteSubscriberUser, resendSubscriberLink, setSubscriberHotelArchived } from "./actions";
import { accountMessages } from "./messages";
import { SubmitButton } from "./submit-button";

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const current = await requirePlatformAdmin();
  const { notice } = await searchParams;
  const message = notice ? accountMessages[notice] : undefined;
  const admin = createAdminClient();
  const { data: accounts, error } = await admin
    .from("accounts")
    .select("id, name, active, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  const { data: memberships, error: memberError } = await admin.from("account_members").select("account_id, user_id, role");
  if (memberError) throw memberError;
  const members = await Promise.all((memberships ?? []).map(async (member) => {
    const { data, error: userError } = await admin.auth.admin.getUserById(member.user_id);
    if (userError) throw userError;
    return { ...member, email: data.user.email ?? "Geen e-mailadres" };
  }));
  const hotels = await fetchAllRows((from, to) => admin.from("hotels")
    .select("id, account_id, name, archived_at").order("name").order("id").range(from, to));

  return (
    <main className="admin-page">
      <header className="page-title">
        <span className="eyebrow">Platformbeheer</span>
        <h1>Abonnees</h1>
      </header>
      {message && <p role="status" className={`notice ${message.success ? "success" : "error"}`}>{message.text}</p>}
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
          <SubmitButton primary>Uitnodigen</SubmitButton>
        </form>
      </section>
      <section className="panel">
        <h2>Bestaande accounts</h2>
        <p>Archiveer hotels die niet meer nodig zijn om nieuwe zoekopdrachten en e-mails te stoppen. Hun geschiedenis blijft bewaard en je kunt ze later herstellen.</p>
        <p>Een verwijderde login stopt de hotelzoekopdrachten niet. Werk dat al bij de zoekdienst is gestart, kan nog kosten geven.</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Naam</th><th>Status</th><th>E-mailadres</th><th>Hotels</th></tr></thead>
            <tbody>
              {accounts?.map((account) => (
                <tr key={account.id}>
                  <td>{account.name}</td>
                  <td>{account.active ? "Actief" : "Uitgeschakeld"}</td>
                  <td>
                    <div className="form-stack">
                      {!members.some((member) => member.account_id === account.id) && <span>Geen login</span>}
                      {members.filter((member) => member.account_id === account.id).map((member) => (
                        <div key={member.user_id} className="subscriber-login">
                          <span>{member.email}</span>
                          {member.role !== "platform_admin" && member.user_id !== current.userId && (
                            <div className="subscriber-login-actions">
                              {account.active && (
                                <form action={resendSubscriberLink}>
                                  <input type="hidden" name="accountId" value={account.id} />
                                  <input type="hidden" name="userId" value={member.user_id} />
                                  <SubmitButton>Nieuwe wachtwoordlink</SubmitButton>
                                </form>
                              )}
                              <form action={deleteSubscriberUser}>
                                <input type="hidden" name="accountId" value={account.id} />
                                <input type="hidden" name="userId" value={member.user_id} />
                                <SubmitButton confirmation={`Login van ${member.email} definitief verwijderen? Hotels en exportgeschiedenis blijven bewaard.`}>Verwijderen</SubmitButton>
                              </form>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </td>
                  <td>
                    {hotels.some((hotel) => hotel.account_id === account.id) ? (
                      <details>
                        <summary>Hotels beheren ({hotels.filter((hotel) => hotel.account_id === account.id).length})</summary>
                        <div className="form-stack">
                          {hotels.filter((hotel) => hotel.account_id === account.id).map((hotel) => (
                            <form key={hotel.id} action={setSubscriberHotelArchived} className="subscriber-login">
                              <span><strong>{hotel.name}</strong><br />{hotel.archived_at ? "Gearchiveerd" : account.active ? "Zoeken aan" : "Account uitgeschakeld"}</span>
                              <input type="hidden" name="accountId" value={account.id} />
                              <input type="hidden" name="hotelId" value={hotel.id} />
                              <input type="hidden" name="archived" value={String(!hotel.archived_at)} />
                              <SubmitButton>{hotel.archived_at ? "Herstellen" : "Archiveren"}</SubmitButton>
                            </form>
                          ))}
                        </div>
                      </details>
                    ) : "Geen hotels"}
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

