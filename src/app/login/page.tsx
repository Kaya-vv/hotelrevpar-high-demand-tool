import Image from "next/image";

import { login } from "./actions";

const errorMessages: Record<string, string> = {
  account: "Dit account is niet actief. Neem contact op met HotelRevPar.",
  credentials: "Controleer je e-mailadres en wachtwoord.",
  invite: "De uitnodiging is verlopen of ongeldig. Vraag HotelRevPar om een nieuwe uitnodiging.",
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
        <Image src="/logo.webp" alt="HotelRevPar" width={210} height={153} priority />
        <div>
          <span className="eyebrow">High Demand Tool</span>
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
