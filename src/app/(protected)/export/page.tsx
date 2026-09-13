import Link from "next/link";
import { eventLocalDate } from "@/features/events/normalize";
import { demandLabels } from "@/features/events/importance";
import { ExportControls } from "@/features/export/export-controls";
import { ExportTabs, ExportPanel } from "@/features/export/export-tabs";
import { ExportFilters } from "@/features/export/export-filters";
import { exportPeriod } from "@/features/export/display";
import { loadExportHistory } from "@/features/export/history";
import { exportRange, loadExportEvents } from "@/features/export/query";
import type { ExportSnapshot } from "@/features/export/types";
import { getHotelScope } from "@/features/workspace/hotel-context";
import { requireAccount } from "@/lib/auth/require-account";

const statusLabels: Record<string, string> = { active: "Actief", cancelled: "Geannuleerd", postponed: "Uitgesteld", excluded: "Verborgen", ended: "Afgelopen", needs_review: "Controle nodig", unavailable: "Niet beschikbaar" };
function snapshotLabel(snapshot: ExportSnapshot | null) {
  return snapshot ? `${snapshot.title} · ${exportPeriod(snapshot.startDate, snapshot.endDate)} · ${demandLabels[snapshot.importance]} · ${statusLabels[snapshot.status] ?? "Niet beschikbaar"}` : "Niet meer beschikbaar voor dit hotel";
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
  const view = params.view === "history" || (!params.view && typeof params.historyPage === "string") ? "history" : params.view === "reexport" ? "reexport" : "new";
  const page = Math.max(0, Math.floor(Number(params.historyPage) || 0));
  const history = selectedHotelIds.length ? await loadExportHistory(accountId, selectedHotelIds, current, page) : [];
  const query = new URLSearchParams({ from: range.start, to: range.end, selection: "1" });
  selectedHotelIds.forEach((id) => query.append("hotel", id));
  const viewLink = (view: string) => `/export?${query}&view=${view}`;
  const pageLink = (page: number) => `${viewLink("history")}&historyPage=${page}`;
  const changed = history.filter((batch) => batch.items.some((item) => item.latest && item.changed)).length;
  return <div className="export-page">
    <header className="page-title"><span className="eyebrow">RevControl</span><h1>Exporteren naar RevControl</h1><p>Download je events en importeer het bestand in RevControl.</p></header>
    <ExportTabs initialView={view} newHref={`${viewLink("new")}${page > 0 ? `&historyPage=${page}` : ""}`} historyHref={`${viewLink("history")}${page > 0 ? `&historyPage=${page}` : ""}`} />
    <ExportFilters hotels={scope.hotels} hotelIds={selectedHotelIds} from={range.start} to={range.end} view={view}>
      {!scope.hotels.length ? <p className="panel">Voeg eerst een hotel toe.</p> : !selectedHotelIds.length ? <p className="panel">Kies een hotel via Aanpassen om de beschikbare events te bekijken.</p> : <>
        <ExportPanel>
          {changed > 0 && <p className="export-change-note">Er zijn events gewijzigd sinds een eerdere export. <Link href={viewLink("history")}>Bekijk wijzigingen</Link></p>}
          <ExportControls key={`${query}-${view}`} events={events} hotelIds={selectedHotelIds} hotelNames={hotelNames} from={range.start} to={range.end} reexport={view === "reexport"} />
        </ExportPanel>
        <ExportPanel history><section className="panel export-history" aria-labelledby="export-history-title">
          <div className="export-history-heading"><div><h2 id="export-history-title">Eerdere exports</h2><p className="muted">Download een opgeslagen bestand opnieuw.</p></div><Link className="secondary" href={viewLink("reexport")}>Nieuwe export van eerdere events</Link></div>
          <p className="muted">We houden bij welke bestanden zijn gemaakt. Of ze in RevControl zijn geïmporteerd, is hier niet bekend.</p>
          {!history.length && <div className="export-empty"><h3>Nog geen exports</h3><p>Je bestanden verschijnen hier na je eerste download.</p></div>}
          {history.map((batch) => {
            const selection = batch.selection as { from: string; to: string; hotelIds: string[] };
            const changes = batch.items.filter((item) => item.latest && item.changed);
            return <article className="export-history-item" key={batch.id}>
              <div className="export-history-heading"><div><h3>{new Date(batch.created_at).toLocaleString("nl-NL", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Amsterdam" })}</h3><p className="muted">{selection.hotelIds.map((id) => hotelNames[id] ?? "Hotel").join(", ")} · {new Set(batch.items.map((item) => item.previous.eventId)).size} events</p><p className="muted">{exportPeriod(selection.from, selection.to)}</p></div><a className="secondary" href={`/api/export/${batch.id}`}>Opnieuw downloaden</a></div>
              {changes.length > 0 && <details className="export-disclosure export-history-changes"><summary>{changes.length} {changes.length === 1 ? "event gewijzigd" : "events gewijzigd"} sinds export</summary><p>Controleer en pas de bestaande vermelding in RevControl aan. Een nieuwe import werkt deze niet bij.</p>{changes.map((item, index) => <div className="export-history-change" key={index}><strong>{item.previous.title} · {hotelNames[item.previous.hotelId]}</strong><p>Toen: {snapshotLabel(item.previous)}</p><p>Nu: {snapshotLabel(item.snapshot)}{!item.eligible ? " · Niet meer exporteerbaar" : ""}</p></div>)}</details>}
              <details className="export-disclosure"><summary>Bekijk inhoud</summary><ul>{batch.items.map((item, index) => <li key={index}>{item.previous.title} · {hotelNames[item.previous.hotelId]} · {exportPeriod(item.previous.startDate, item.previous.endDate)}</li>)}</ul></details>
            </article>;
          })}
          <nav className="export-history-pagination" aria-label="Exportgeschiedenis pagina’s">{page > 0 && <Link href={pageLink(page - 1)}>Nieuwere exports</Link>} {history.length === 20 && <Link href={pageLink(page + 1)}>Oudere exports</Link>}</nav>
        </section></ExportPanel>
      </>}
    </ExportFilters>
  </div>;
}
