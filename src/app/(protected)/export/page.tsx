import { requireAccount } from "@/lib/auth/require-account";
import { createServerClient } from "@/lib/supabase/server";

export default async function ExportPage() {
  const { accountId } = await requireAccount();
  const { data: hotels, error } = await (await createServerClient())
    .from("hotels")
    .select("id, name, revcontrol_code")
    .eq("account_id", accountId)
    .order("name");
  if (error) throw error;

  return (
    <div>
      <header className="page-title"><span className="eyebrow">RevControl</span><h1>Exporteren</h1><p>Download actieve gebeurtenissen per maand. Hotels met een andere Importance krijgen een eigen rij.</p></header>
      <section className="panel export-panel">
        <form action="/api/export" method="get" className="form-stack">
          <label>Maand<input name="month" type="month" defaultValue={new Date().toISOString().slice(0, 7)} required /></label>
          <fieldset className="checkbox-grid">
            <legend>Hotels</legend>
            {hotels.map((hotel) => <label key={hotel.id}><input name="hotel" type="checkbox" value={hotel.id} defaultChecked />{hotel.name} ({hotel.revcontrol_code})</label>)}
          </fieldset>
          {!hotels.length && <p className="notice error">Voeg eerst een hotel toe.</p>}
          <button className="primary" type="submit" disabled={!hotels.length}>Excel downloaden</button>
        </form>
      </section>
    </div>
  );
}

