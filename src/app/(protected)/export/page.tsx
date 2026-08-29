import { demandLabels, type DemandLevel } from "@/features/events/importance";
import { mapRevControlRows } from "@/features/export/map-rows";
import { loadExportEvents } from "@/features/export/query";
import { getHotelScope } from "@/features/workspace/hotel-context";
import { requireAccount } from "@/lib/auth/require-account";

function value(params: Record<string, string | string[] | undefined>, key: string) {
  const item = params[key];
  return typeof item === "string" ? item : undefined;
}

export default async function ExportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { accountId } = await requireAccount();
  const params = await searchParams;
  const scope = await getHotelScope(accountId);
  const rawMonth = value(params, "month");
  const month = rawMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(rawMonth) ? rawMonth : new Date().toISOString().slice(0, 7);
  const requestedHotels = Array.isArray(params.hotel) ? params.hotel : typeof params.hotel === "string" ? [params.hotel] : [];
  const includeProvisional = value(params, "includeProvisional") === "1";
  const ownedHotelIds = new Set(scope.hotels.map((hotel) => hotel.id));
  const selectedHotelIds = requestedHotels.length
    ? [...new Set(requestedHotels)].filter((hotelId) => ownedHotelIds.has(hotelId))
    : scope.selectedHotelId ? [scope.selectedHotelId] : [];
  const { hotels, events } = selectedHotelIds.length
    ? await loadExportEvents(accountId, month, selectedHotelIds, includeProvisional)
    : { hotels: [], events: [] };
  const rows = mapRevControlRows(events, selectedHotelIds);
  const query = new URLSearchParams({ month });
  selectedHotelIds.forEach((hotelId) => query.append("hotel", hotelId));
  if (includeProvisional) query.set("includeProvisional", "1");

  return (
    <div>
      <header className="page-title"><span className="eyebrow">RevControl</span><h1>Exporteren</h1><p>Controleer de maand en hotels voordat je het Excel-bestand downloadt.</p></header>
      <section className="panel export-panel">
        <form method="get" className="form-stack">
          <label>Maand<input name="month" type="month" defaultValue={month} required /></label>
          <fieldset className="checkbox-grid">
            <legend>Hotels</legend>
            {scope.hotels.map((hotel) => <label key={hotel.id}><input name="hotel" type="checkbox" value={hotel.id} defaultChecked={selectedHotelIds.includes(hotel.id)} />{hotel.name}</label>)}
          </fieldset>
          <label className="checkbox-row"><input name="includeProvisional" type="checkbox" value="1" defaultChecked={includeProvisional} />Ook mogelijke, nog onbevestigde vraagmomenten opnemen</label>
          {includeProvisional && <p className="notice warning">Je kiest er voor deze export bewust voor om voorlopige datums aan RevControl door te geven.</p>}
          {!scope.hotels.length && <p className="notice error">Voeg eerst een hotel toe.</p>}
          <button className="secondary" type="submit" disabled={!scope.hotels.length}>Voorbeeld vernieuwen</button>
        </form>
      </section>

      {selectedHotelIds.length > 0 && (
        <section className="panel export-preview">
          <div className="preview-heading"><div><span className="eyebrow">Voorbeeld</span><h2>{events.length} events, {rows.length} Excel-rijen</h2></div><a className="primary link-button" href={`/api/export?${query}`}>Excel downloaden</a></div>
          <p className="muted">Hotels: {hotels.map((hotel) => `${hotel.name} (${hotel.revcontrol_code})`).join(", ")}</p>
          {rows.length ? (
            <div className="table-wrap"><table><thead><tr><th>Event</th><th>Start</th><th>Einde</th><th>Vraag</th><th>Hotelcodes</th></tr></thead><tbody>{rows.slice(0, 20).map((row, index) => <tr key={`${row.event}-${index}`}><td>{row.event}</td><td>{row.startDate.toLocaleDateString("nl-NL")}</td><td>{row.endDate.toLocaleDateString("nl-NL")}</td><td>{demandLabels[row.importance as Exclude<DemandLevel, "Peak">]}</td><td>{row.hotels}</td></tr>)}</tbody></table></div>
          ) : <p className="empty-state">Geen actieve events voor deze selectie.</p>}
          {rows.length > 20 && <p className="muted">Het voorbeeld toont de eerste 20 rijen.</p>}
        </section>
      )}
    </div>
  );
}
