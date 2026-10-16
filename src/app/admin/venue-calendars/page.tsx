import {
  removeVenueCalendar, removeVenueSearch, saveVenueCalendar, saveVenueSearch, setVenueCalendarActive, setVenueSearchActive,
} from "@/features/collection/venue-calendar-actions";
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
  "search-added": { text: "Zaal toegevoegd. Het onderzoek zoekt vanaf de volgende ronde naar congressen in deze zaal.", success: true },
  "search-updated": { text: "Deze zaal stond er al en staat weer aan.", success: true },
  "search-switched-on": { text: "Zoeken aangezet. Het onderzoek zoekt weer naar congressen in deze zaal.", success: true },
  "search-switched-off": { text: "Zoeken uitgezet. Al gevonden evenementen blijven staan.", success: true },
  "search-removed": { text: "Zaal verwijderd. Al gevonden evenementen blijven staan.", success: true },
  "search-input": { text: "Vul de naam van de zaal en een plaats in." },
  missing: { text: "Deze regel bestaat niet meer. Vernieuw de pagina." },
  failed: { text: "De actie is niet gelukt. Probeer opnieuw." },
};

export default async function VenueCalendarsPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  await requirePlatformAdmin();
  const { notice } = await searchParams;
  const message = notice ? messages[notice] : undefined;
  const admin = createAdminClient();
  const [{ data: calendars, error }, { data: searches, error: searchError }] = await Promise.all([
    admin.from("venue_calendars").select("id, name, url, city, national, active").order("city").order("name"),
    admin.from("venue_searches").select("id, name, city, active").order("city").order("name"),
  ]);
  if (error) throw error;
  if (searchError) throw searchError;

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
      <section className="panel">
        <h2>Zalen zonder agenda</h2>
        <p>Congreszalen die hun zakelijke evenementen niet online zetten. Het onderzoek zoekt elke ronde op de naam van de zaal naar congressen in de komende drie maanden, per maand in het Nederlands en het Engels. Dat kost zes tot acht extra zoekopdrachten per zaal per ronde.</p>
        <form action={saveVenueSearch} className="inline-form venue-calendar-form">
          <label>
            Naam van de zaal
            <input name="name" required />
          </label>
          <label>
            Plaats
            <input name="city" required />
          </label>
          <SubmitButton primary>Toevoegen</SubmitButton>
        </form>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Naam</th><th>Plaats</th><th>Status</th><th>Beheer</th></tr></thead>
            <tbody>
              {searches.map((search) => (
                <tr key={search.id}>
                  <td>{search.name}</td>
                  <td>{search.city}</td>
                  <td>{search.active ? "Aan" : "Uit"}</td>
                  <td>
                    <div className="subscriber-login-actions">
                      <form action={setVenueSearchActive}>
                        <input type="hidden" name="id" value={search.id} />
                        <input type="hidden" name="active" value={String(!search.active)} />
                        <SubmitButton>{search.active ? "Uitzetten" : "Aanzetten"}</SubmitButton>
                      </form>
                      <form action={removeVenueSearch}>
                        <input type="hidden" name="id" value={search.id} />
                        <SubmitButton confirmation={`${search.name} van de lijst verwijderen? Al gevonden evenementen blijven staan.`}>Verwijderen</SubmitButton>
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
