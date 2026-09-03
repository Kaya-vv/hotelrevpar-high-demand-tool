import Image from "next/image";

import { login } from "./actions";

const errorMessages: Record<string, string> = {
  account: "Dit account is niet actief. Neem contact op met DemandRadar.",
  credentials: "Controleer je e-mailadres en wachtwoord.",
  invite:
    "De uitnodiging is verlopen of ongeldig. Vraag DemandRadar om een nieuwe uitnodiging.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="login-page">
      <section className="login-card">
        <Image src="/DemandRadar-Logo.png" alt="DemandRadar" width={210} height={140} priority />
        <div>
          <h1>Inloggen</h1>
        </div>
        {error && <p className="notice error">{errorMessages[error] ?? "Inloggen is mislukt."}</p>}
        <form action={login} className="form-stack">
          <label>
            E-mailadres
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label>
            Wachtwoord
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          <button className="primary" type="submit">
            Inloggen
          </button>
        </form>
      </section>
    </main>
  );
}
