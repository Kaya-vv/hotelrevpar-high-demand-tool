import { requirePlatformAdmin } from "@/lib/auth/require-account";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/supabase/fetch-in-batches";

import { createSubscriberAccount, deleteSubscriberUser, resendSubscriberLink, setAccountHotelLimit, setSubscriberHotelArchived } from "./actions";
import { accountMessages } from "./messages";
import { SubmitButton } from "./submit-button";

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ notice?: string; account?: string }> }) {
  const current = await requirePlatformAdmin();
  const { notice, account: openAccount } = await searchParams;
  const message = notice ? accountMessages[notice] : undefined;
  const admin = createAdminClient();
  const { data: accounts, error } = await admin
    .from("accounts")
    .select("id, name, active, created_at, hotel_limit, trial_ends_at")
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
  const hasLogin = (accountId: string) => members.some((member) => member.account_id === accountId);
  const shown = (accounts ?? []).filter((account) => account.active && hasLogin(account.id));
  const hidden = (accounts ?? []).filter((account) => !account.active || !hasLogin(account.id));
  // Hidden accounts without a login still search for their non-archived hotels; keep that cost visible.
  const stillSearching = hotels.filter((hotel) => !hotel.archived_at
    && hidden.some((account) => account.id === hotel.account_id && account.active)).length;
  // A result belongs next to the account it came from; only results without one go at the top.
  const resultInAccount = (accounts ?? []).some((account) => account.id === openAccount);
  const notification = message && <p role="status" className={`notice ${message.success ? "success" : "error"}`}>{message.text}</p>;

  const accountList = (rows: typeof shown) => (
    <div className="account-list">
      <div className="account-row account-head" aria-hidden="true">
        <span>Account</span><span>Abonnement</span><span>Logins</span><span>Hotels</span><span>Hotellimiet</span><span />
      </div>
      {rows.map((account) => {
        const accountMembers = members.filter((member) => member.account_id === account.id);
        const accountHotels = hotels.filter((hotel) => hotel.account_id === account.id);
        const searching = accountHotels.filter((hotel) => !hotel.archived_at).length;
        const archived = accountHotels.length - searching;
        const adminAccount = accountMembers.some((member) => member.role === "platform_admin");
        const removable = (member: (typeof members)[number]) => member.role !== "platform_admin" && member.user_id !== current.userId;
        return (
          <details key={account.id} name="account" className="account-item" open={account.id === openAccount}>
            <summary className="account-row">
              <strong>{account.name}</strong>
              <span>{!account.active ? "Uitgeschakeld"
                : account.trial_ends_at
                  ? `Proef t/m ${new Date(account.trial_ends_at).toLocaleDateString("nl-NL", { dateStyle: "medium", timeZone: "Europe/Amsterdam" })}`
                  : "Betaald"}</span>
              <span>
                {accountMembers.length === 0 ? "Geen login"
                  : accountMembers.length === 1 ? accountMembers[0].email
                  : `${accountMembers.length} logins`}
                {adminAccount && <span className="muted"> · beheer</span>}
              </span>
              <span>
                {accountHotels.length === 0 ? "Geen hotels" : `${searching} actief`}
                {archived > 0 && <span className="muted"> · {archived} gearchiveerd</span>}
              </span>
              <span>{account.hotel_limit ?? "Onbeperkt"}</span>
              <span className="account-toggle" aria-hidden="true" />
            </summary>
            <div className="account-manage">
              {account.id === openAccount && notification}
              <section aria-label={`Logins van ${account.name}`}>
                <h3>Logins</h3>
                {accountMembers.length === 0 && <p className="muted">Dit account heeft geen login. De hotels blijven bewaard.</p>}
                {accountMembers.map((member) => (
                  <div key={member.user_id} className="account-login">
                    <span>{member.email}{member.role === "platform_admin" && <span className="muted"> · beheerder</span>}</span>
                    {removable(member) && (
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
                {account.active && (
                  <form action={createSubscriberAccount} className="compact-form">
                    <input type="hidden" name="accountId" value={account.id} />
                    <input name="email" type="email" required placeholder="Nieuw e-mailadres"
                      aria-label={`Login toevoegen aan ${account.name}`} />
                    <SubmitButton>Login toevoegen</SubmitButton>
                  </form>
                )}
                {account.active && adminAccount && <p className="muted">Een nieuwe login krijgt beheerrechten, net als de andere logins van dit account.</p>}
                {accountMembers.some(removable) && <p className="muted">Een verwijderde login stopt de hotelzoekopdrachten niet. Werk dat al bij de zoekdienst is gestart, kan nog kosten geven.</p>}
              </section>
              <section aria-label={`Hotels van ${account.name}`}>
                <h3>Hotels</h3>
                {accountHotels.length === 0 && <p className="muted">Geen hotels.</p>}
                {accountHotels.map((hotel) => (
                  <form key={hotel.id} action={setSubscriberHotelArchived} className="subscriber-login">
                    <span><strong>{hotel.name}</strong><br /><span className="muted">{hotel.archived_at ? "Gearchiveerd" : account.active ? "Zoeken aan" : "Account uitgeschakeld"}</span></span>
                    <input type="hidden" name="accountId" value={account.id} />
                    <input type="hidden" name="hotelId" value={hotel.id} />
                    <input type="hidden" name="archived" value={String(!hotel.archived_at)} />
                    <SubmitButton>{hotel.archived_at ? "Herstellen" : "Archiveren"}</SubmitButton>
                  </form>
                ))}
                {accountHotels.length > 0 && <p className="muted">Archiveren stopt nieuwe zoekopdrachten en e-mails voor dat hotel. De geschiedenis blijft bewaard en je kunt het later herstellen.</p>}
              </section>
              <section aria-label={`Hotellimiet van ${account.name}`}>
                <h3>Hotellimiet</h3>
                <form action={setAccountHotelLimit} className="compact-form">
                  <input type="hidden" name="accountId" value={account.id} />
                  <input name="hotelLimit" type="number" min="0" placeholder="Onbeperkt"
                    defaultValue={account.hotel_limit ?? ""} aria-label={`Aantal hotels voor ${account.name}`} />
                  <SubmitButton>Opslaan</SubmitButton>
                </form>
                <p className="muted">Laat leeg voor onbeperkt.</p>
              </section>
            </div>
          </details>
        );
      })}
    </div>
  );

  return (
    <main className="admin-page">
      <header className="page-title">
        <span className="eyebrow">Platformbeheer</span>
        <h1>Abonnees</h1>
      </header>
      {!resultInAccount && notification}
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
          <label>
            Aantal hotels
            <input name="hotelLimit" type="number" min="0" placeholder="Onbeperkt" />
          </label>
          <SubmitButton primary>Uitnodigen</SubmitButton>
        </form>
      </section>
      <section className="panel">
        <h2>Bestaande accounts</h2>
        {accountList(shown)}
        {hidden.length > 0 && (
          <details className="hidden-accounts" open={hidden.some((account) => account.id === openAccount)}>
            <summary>
              Uitgeschakeld of zonder login ({hidden.length})
              {stillSearching > 0 && ` · ${stillSearching} ${stillSearching === 1 ? "hotel zoekt" : "hotels zoeken"} nog`}
            </summary>
            {accountList(hidden)}
          </details>
        )}
      </section>
    </main>
  );
}
