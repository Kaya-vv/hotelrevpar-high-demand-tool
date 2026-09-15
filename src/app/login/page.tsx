import Image from "next/image";
import Link from "next/link";

import { login, requestPasswordReset } from "./actions";
import { loginDestination } from "@/lib/auth/login-destination";

const errorMessages: Record<string, string> = {
  account: "Dit account is niet actief. Neem contact op met DemandRadar.",
  credentials: "Controleer je e-mailadres en wachtwoord.",
  invite:
    "Deze link is ongeldig, verlopen of al gebruikt. Vraag via ‘Wachtwoord vergeten?’ een nieuwe link aan.",
  email: "Vul een geldig e-mailadres in.",
  reset: "De aanvraag is niet gelukt. Wacht even en probeer het opnieuw.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; reset?: string; sent?: string }>;
}) {
  const { error, next, reset, sent } = await searchParams;
  const resetting = reset === "true";

  return (
    <main className="login-page">
      <section className="login-card">
        <Image src="/DemandRadar-Logo.png" alt="DemandRadar" width={210} height={140} priority />
        <div>
          <h1>{resetting ? "Wachtwoord herstellen" : "Inloggen"}</h1>
        </div>
        {error && <p className="notice error">{errorMessages[error] ?? "Inloggen is mislukt."}</p>}
        {resetting ? <>
          {sent === "true" ? <p className="notice" role="status">Als dit e-mailadres bij ons bekend is, ontvang je een link om een wachtwoord in te stellen. Controleer ook je spammap.</p> : <>
            <p>Vul het e-mailadres van je account in. Je ontvangt een link om een nieuw wachtwoord in te stellen.</p>
            <form action={requestPasswordReset} className="form-stack">
              <label>E-mailadres<input name="email" type="email" autoComplete="email" required /></label>
              <button className="primary" type="submit">Verstuur wachtwoordlink</button>
            </form>
          </>}
          <Link href="/login">Terug naar inloggen</Link>
        </> : <><form action={login} className="form-stack">
          <input type="hidden" name="next" value={loginDestination(next)} />
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
        <Link href="/login?reset=true">Wachtwoord vergeten?</Link></>}
      </section>
    </main>
  );
}
