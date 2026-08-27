import Image from "next/image";

import { setPassword } from "./actions";

const errorMessages: Record<string, string> = {
  length: "Gebruik minstens 12 tekens.",
  match: "De wachtwoorden komen niet overeen.",
  save: "Het wachtwoord kon niet worden opgeslagen. Open de uitnodiging opnieuw.",
};

export default async function SetPasswordPage({
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
          <h1>Wachtwoord instellen</h1>
        </div>
        {error && <p className="notice error">{errorMessages[error] ?? "Probeer het opnieuw."}</p>}
        <form action={setPassword} className="form-stack">
          <label>Wachtwoord<input name="password" type="password" minLength={12} autoComplete="new-password" required /></label>
          <label>Herhaal wachtwoord<input name="confirmation" type="password" minLength={12} autoComplete="new-password" required /></label>
          <button className="primary" type="submit">Wachtwoord opslaan</button>
        </form>
      </section>
    </main>
  );
}
