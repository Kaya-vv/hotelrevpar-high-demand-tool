import { eventLocalDate } from "@/features/events/normalize";
import { demandLabels } from "@/features/events/importance";
import { ExportControls } from "@/features/export/export-controls";
import { loadExportHistory } from "@/features/export/history";
import { exportRange, loadExportEvents } from "@/features/export/query";
import type { ExportSnapshot } from "@/features/export/types";
import { getHotelScope } from "@/features/workspace/hotel-context";
import { requireAccount } from "@/lib/auth/require-account";

const statusLabels: Record<string, string> = { active: "Actief", cancelled: "Geannuleerd", postponed: "Uitgesteld", excluded: "Verborgen", ended: "Afgelopen", needs_review: "Controle nodig", unavailable: "Niet beschikbaar" };
function snapshotLabel(snapshot: ExportSnapshot | null) {
  return snapshot ? `${snapshot.title} · ${snapshot.startDate} – ${snapshot.endDate} · ${snapshot.hotelCode} · ${demandLabels[snapshot.importance]} · ${statusLabels[snapshot.status] ?? "Niet beschikbaar"}` : "Niet meer beschikbaar voor dit hotel";
}

export default async function ExportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { accountId } = await requireAccount();
  const params = await searchParams;
  const scope = await getHotelScope(accountId);
  const range = exportRange(typeof params.from === "string" ? params.from : null, typeof params.to === "string" ? params.to : null);
  const requested = Array.isArray(params.hotel) ? params.hotel : typeof params.hotel === "string" ? [params.hotel] : [];
  const selectedHotelIds = requested.length ? [...new Set(requested)].filter((id) => scope.hotels.some((hotel) => hotel.id === id)) : params.selection === "1" ? [] : scope.selectedHotelId ? [scope.selectedHotelId] : [];
  const hotelNames = Object.fromEntries(scope.hotels.map((hotel) => [hotel.id, hotel.name]));
  const { events: current } = selectedHotelIds.length ? await loadExportEvents(accountId, range, selectedHotelIds, true) : { events: [] };
  const events = current.filter((event) => event.status === "active" && eventLocalDate(event.startAt) <= range.end && eventLocalDate(event.endAt) >= range.start);
  const page = Math.max(0, Math.floor(Number(params.historyPage) || 0));
  const history = selectedHotelIds.length ? await loadExportHistory(accountId, selectedHotelIds, current, page) : [];
  const query = new URLSearchParams({ from: range.start, to: range.end });
  selectedHotelIds.forEach((id) => query.append("hotel", id));
  const pageLink = (page: number) => `/export?${query}&historyPage=${page}#export-history`;
  return <div>
    <header className="page-title"><span className="eyebrow">RevControl</span><h1>Exporteren</h1><p>Exporteer nieuwe events per hotel of download een eerdere export opnieuw.</p></header>
    <section className="panel export-panel"><form method="get" className="export-settings">
      <input type="hidden" name="selection" value="1" />
      <div className="date-range"><label>Van<input name="from" type="date" defaultValue={range.start} required /></label><label>Tot en met<input name="to" type="date" defaultValue={range.end} required /></label></div>
      <fieldset className="checkbox-grid"><legend>Hotels</legend>{scope.hotels.map((hotel) => <label key={hotel.id}><input name="hotel" type="checkbox" value={hotel.id} defaultChecked={selectedHotelIds.includes(hotel.id)} />{hotel.name}</label>)}</fieldset>
      <button type="submit" className="secondary" disabled={!scope.hotels.length}>Selectie toepassen</button>
      {!scope.hotels.length && <p>Voeg eerst een hotel toe.</p>}
      {scope.hotels.length > 0 && !selectedHotelIds.length && <p>Kies minstens één hotel.</p>}
    </form></section>
    {selectedHotelIds.length > 0 && <ExportControls key={query.toString()} events={events} hotelIds={selectedHotelIds} hotelNames={hotelNames} from={range.start} to={range.end} />}
    <details className="panel export-disclosure export-history" open={typeof params.historyPage === "string"}><summary>Exportgeschiedenis <span className="muted">· {history.length}{history.length === 20 ? "+" : ""} exports{page > 0 ? " op deze pagina" : ""}</span>{history.some((batch) => batch.items.some((item) => item.latest && item.changed)) && <span className="export-history-changes"> · Gewijzigd sinds export</span>}</summary><div id="export-history"><p>Een opgeslagen export bevestigt niet dat het bestand in RevControl is geïmporteerd. Download opnieuw om een onderbroken import te herhalen.</p>
      {!history.length && <p>Nog geen exports.</p>}
      {history.map((batch) => {
        const selection = batch.selection as { from: string; to: string; hotelIds: string[] };
        return <details key={batch.id}><summary>{new Date(batch.created_at).toLocaleString("nl-NL")} · {selection.from} – {selection.to} · {selection.hotelIds.map((id) => hotelNames[id] ?? "Hotel").join(", ")} · {new Set(batch.items.map((item) => item.previous.eventId)).size} events voor geselecteerde hotels{batch.items.some((item) => item.latest && item.changed) ? " · Gewijzigd sinds export" : ""}</summary>
          <p><a href={`/api/export/${batch.id}`}>Oorspronkelijk bestand opnieuw downloaden</a> (alle hotels in deze export)</p>
          {batch.items.map((item, index) => <div key={index}><p><strong>{item.previous.title}</strong> · {hotelNames[item.previous.hotelId]}{item.latest && item.changed ? " · Gewijzigd sinds export" : ""}</p>
            <p>Geëxporteerd: {snapshotLabel(item.previous)}</p>
            {item.latest && item.changed && <><p>Nu: {snapshotLabel(item.snapshot)}{!item.eligible ? " · Niet meer exporteerbaar" : ""}</p><p>Controleer en pas de bestaande vermelding in RevControl aan. Een nieuwe import werkt deze niet bij.</p></>}
          </div>)}
        </details>;
      })}
      <nav aria-label="Exportgeschiedenis pagina’s">{page > 0 && <a href={pageLink(page - 1)}>Nieuwere exports</a>} {history.length === 20 && <a href={pageLink(page + 1)}>Oudere exports</a>}</nav>
    </div></details>
  </div>;
}
