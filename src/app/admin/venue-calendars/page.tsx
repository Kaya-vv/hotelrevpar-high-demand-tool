import { removeVenueCalendar, saveVenueCalendar, setVenueCalendarActive } from "@/features/collection/venue-calendar-actions";
import { requirePlatformAdmin } from "@/lib/auth/require-account";
import { createAdminClient } from "@/lib/supabase/admin";

import { SubmitButton } from "../accounts/submit-button";

const messages: Record<string, { text: string; success?: boolean }> = {
  added: { text: "Agenda toegevoegd. Het onderzoek leest deze pagina vanaf de volgende wekelijkse ronde.", success: true },
  updated: { text: "Deze agenda stond er al. De gegevens zijn bijgewerkt en de agenda staat weer aan.", success: true },
  "switched-on": { text: "Agenda aangezet. Het onderzoek leest deze pagina weer wekelijks.", success: true },
  "switched-off": { text: "Agenda uitgezet. Al gevonden evenementen blijven staan; de pagina wordt niet meer wekelijks gelezen.", success: true },
  removed: { text: "Agenda verwijderd. Al gevonden evenementen blijven staan.", success: true },
  input: { text: "Vul een naam, een plaats en een geldig adres dat met https:// begint in." },
  missing: { text: "Deze agenda bestaat niet meer. Vernieuw de pagina." },
  failed: { text: "De actie is niet gelukt. Probeer opnieuw." },
};

export default async function VenueCalendarsPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  await requirePlatformAdmin();
  const { notice } = await searchParams;
  const message = notice ? messages[notice] : undefined;
  const { data: calendars, error } = await createAdminClient().from("venue_calendars")
    .select("id, name, url, city, national, active").order("city").order("name");
  if (error) throw error;

  return (
    <main className="admin-page">
      <header className="page-title">
        <span className="eyebrow">Platformbeheer</span>
        <h1>Zaalagenda’s</h1>
        <p>Agenda’s van grote zalen en organisatoren. Het onderzoek leest elke actieve agenda wekelijks voor hotels binnen de straal van de plaats. Landelijke agenda’s worden voor alle hotels gelezen.</p>
      </header>
      {message && <p role="status" className={`notice ${message.success ? "success" : "error"}`}>{message.text}</p>}
      <section className="panel">
        <h2>Agenda toevoegen</h2>
        <form action={saveVenueCalendar} className="inline-form venue-calendar-form">
          <label>
            Naam
            <input name="name" required />
          </label>
          <label>
            Agenda-adres
            <input name="url" type="url" pattern="https://.*" placeholder="https://" required />
          </label>
          <label>
            Plaats
            <input name="city" required />
          </label>
          <label className="inline-check">
            <input name="national" type="checkbox" /> Landelijk
          </label>
          <SubmitButton primary>Toevoegen</SubmitButton>
        </form>
      </section>
      <section className="panel">
        <h2>Agenda’s</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Naam</th><th>Plaats</th><th>Landelijk</th><th>Status</th><th>Beheer</th></tr></thead>
            <tbody>
              {calendars.map((calendar) => (
                <tr key={calendar.id}>
                  <td><a href={calendar.url} target="_blank" rel="noreferrer">{calendar.name}</a></td>
                  <td>{calendar.city}</td>
                  <td>{calendar.national ? "Ja" : "Nee"}</td>
                  <td>{calendar.active ? "Aan" : "Uit"}</td>
                  <td>
                    <div className="subscriber-login-actions">
                      <form action={setVenueCalendarActive}>
                        <input type="hidden" name="id" value={calendar.id} />
                        <input type="hidden" name="active" value={String(!calendar.active)} />
                        <SubmitButton>{calendar.active ? "Uitzetten" : "Aanzetten"}</SubmitButton>
                      </form>
                      <form action={removeVenueCalendar}>
                        <input type="hidden" name="id" value={calendar.id} />
                        <SubmitButton confirmation={`${calendar.name} van de lijst verwijderen? Al gevonden evenementen blijven staan.`}>Verwijderen</SubmitButton>
                      </form>
                    </div>
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
