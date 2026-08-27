import { requireAccount } from "@/lib/auth/require-account";

import { logout } from "./actions";

export default async function AccountPage() {
  const account = await requireAccount();
  return (
    <div>
      <header className="page-title"><span className="eyebrow">Account</span><h1>{account.accountName}</h1></header>
      <section className="panel account-panel">
        <p><strong>Rol</strong><br />{account.role === "platform_admin" ? "Platformbeheerder" : "Operator"}</p>
        <form action={logout}><button className="secondary" type="submit">Uitloggen</button></form>
      </section>
    </div>
  );
}

