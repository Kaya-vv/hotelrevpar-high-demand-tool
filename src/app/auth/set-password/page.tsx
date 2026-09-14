import Image from "next/image";
import type { Metadata } from "next";

import { setPassword } from "./actions";

export const metadata: Metadata = { referrer: "no-referrer" };

const errorMessages: Record<string, string> = {
  length: "Gebruik minstens 6 tekens.",
  match: "De wachtwoorden komen niet overeen.",
  save: "Het wachtwoord kon niet worden opgeslagen. Probeer het opnieuw.",
};

export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; token_hash?: string; type?: string }>;
}) {
  const { error, token_hash: tokenHash, type } = await searchParams;

  return (
    <main className="login-page">
      <section className="login-card">
        <Image src="/DemandRadar-Logo.png" alt="DemandRadar" width={210} height={140} priority />
        <div>
          <h1>Wachtwoord instellen</h1>
          <p>Kies zelf een wachtwoord. Daarna kun je inloggen met je e-mailadres en dit wachtwoord.</p>
        </div>
        {error && <p className="notice error">{errorMessages[error] ?? "Probeer het opnieuw."}</p>}
        <form action={setPassword} className="form-stack">
          {tokenHash && <input type="hidden" name="token_hash" value={tokenHash} />}
          {type && <input type="hidden" name="type" value={type} />}
          <label>Wachtwoord<input name="password" type="password" minLength={6} autoComplete="new-password" required /></label>
          <label>Herhaal wachtwoord<input name="confirmation" type="password" minLength={6} autoComplete="new-password" required /></label>
          <button className="primary" type="submit">Wachtwoord opslaan</button>
        </form>
      </section>
    </main>
  );
}
