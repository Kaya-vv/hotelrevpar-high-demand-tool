"use client";

import { Fragment, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { demandLabels, demandLevels, isPublishableDemand, type DemandLevel } from "../events/importance";
import { eventLocalDate } from "../events/normalize";
import { exportMonth, exportPeriod } from "./display";
import { mapRevControlRows } from "./map-rows";
import { pairKey, selectExportEvents } from "./selection";
import type { ExportEvent } from "./types";

export function ExportControls({ events, hotelIds, hotelNames, from, to, reexport = false }: {
  events: ExportEvent[]; hotelIds: string[]; hotelNames: Record<string, string>; from: string; to: string; reexport?: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [levels, setLevels] = useState<Record<string, DemandLevel>>({});
  const [busy, setBusy] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [download, setDownload] = useState("");
  const pending = useRef<{ signature: string; key: string } | null>(null);
  const mode = reexport ? "selected" : "new";
  const rows = [...events].sort((a, b) => eventLocalDate(a.startAt).localeCompare(eventLocalDate(b.startAt)) || a.title.localeCompare(b.title, "nl")).flatMap((event) => event.hotels.filter((hotel) => hotel.available !== false && (reexport || !hotel.exportedAt) && (hotel.announced || isPublishableDemand(hotel.importance, hotel.impactBasis))).map((hotel) => ({ event, hotel, key: pairKey(event.id, hotel.id) })));
  const ready = rows.filter(({ hotel }) => !hotel.announced);
  const announcements = rows.filter(({ hotel }) => hotel.announced);
  const effectivePairs = selected.filter((key) => rows.some((row) => row.key === key));
  const choices = announcements.filter(({ key }) => effectivePairs.includes(key) && levels[key]).map(({ event, hotel, key }) => ({ eventId: event.id, hotelId: hotel.id, importance: levels[key] }));
  const preview = selectExportEvents(events, mode, effectivePairs, choices);
  const workbookRows = mapRevControlRows(preview, hotelIds);
  const locked = busy || refreshing;

  function choose(key: string, level: string) {
    setLevels({ ...levels, [key]: level as DemandLevel });
    setSelected((current) => level ? [...current.filter((item) => item !== key), key] : current.filter((item) => item !== key));
  }

  async function create() {
    if (locked) return;
    setBusy(true); setError(""); setNotice(""); setDownload("");
    const body = { from, to, hotelIds, mode, selectedPairs: effectivePairs, choices };
    const signature = JSON.stringify(body);
    if (pending.current?.signature !== signature) pending.current = { signature, key: crypto.randomUUID() };
    try {
      const response = await fetch("/api/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, requestKey: pending.current.key }) });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 409) {
          pending.current = null;
          setSelected([]);
          setNotice("De beschikbaarheid is veranderd. De lijst wordt vernieuwd. Controleer de bijgewerkte selectie voordat je opnieuw downloadt.");
          startRefresh(() => router.refresh());
          return;
        }
        throw new Error(result.error ?? "Export maken mislukt. Probeer opnieuw.");
      }
      setDownload(result.url);
      window.location.assign(result.url);
      startRefresh(() => router.refresh());
    } catch (error) { setError(error instanceof Error ? error.message : "Download mislukt. Probeer opnieuw met dezelfde selectie."); }
    finally { setBusy(false); }
  }

  function eventTable(items: typeof rows, optional = false) {
    return hotelIds.map((hotelId) => {
      const hotelRows = items.filter(({ hotel }) => hotel.id === hotelId);
      if (!hotelRows.length) return null;
      return <section className="export-hotel-group" key={hotelId} aria-label={hotelNames[hotelId]}>
        {hotelIds.length > 1 && <h3>{hotelNames[hotelId]}</h3>}
        <div className="table-wrap"><table className="export-event-table"><thead><tr><th>Event</th><th>Datum</th><th>{optional ? "Toevoegen aan export" : "Niveau"}</th></tr></thead><tbody>
          {hotelRows.map(({ event, hotel, key }, index) => <Fragment key={key}>
            {(index === 0 || exportMonth(hotelRows[index - 1].event.startAt) !== exportMonth(event.startAt)) && <tr className="export-month"><th colSpan={3} scope="rowgroup">{exportMonth(event.startAt)}</th></tr>}
            <tr>
              <td>{reexport && !optional ? <label className="export-row-toggle"><input aria-label={`Selecteer ${event.title} voor ${hotelNames[hotel.id]}`} type="checkbox" checked={selected.includes(key)} onChange={(e) => setSelected(e.target.checked ? [...selected, key] : selected.filter((item) => item !== key))} />{event.title}</label> : event.title}</td>
              <td className="export-event-date">{exportPeriod(event.startAt, event.endAt)}</td>
              <td>{optional ? <select aria-label={`Exportniveau ${event.title} voor ${hotelNames[hotel.id]}`} value={selected.includes(key) ? levels[key] ?? "" : ""} onChange={(e) => choose(key, e.target.value)}><option value="">Niet meenemen</option>{demandLevels.map((level) => <option key={level} value={level}>Toevoegen als {demandLabels[level].toLowerCase()}</option>)}</select> : <span className={`export-level export-level-${hotel.importance.toLowerCase()}`}>{demandLabels[hotel.importance]}</span>}</td>
            </tr>
          </Fragment>)}
        </tbody></table></div>
      </section>;
    });
  }

  return <section className="panel export-preview">
    <div className="export-section-heading"><h2>{reexport ? "Events opnieuw exporteren" : "Nieuwe events"}</h2><p className="muted">{reexport ? "Selecteer de events die je nogmaals wilt importeren." : "Eerder geëxporteerde events worden automatisch overgeslagen."}</p></div>
    {reexport && <p className="notice">Opnieuw importeren kan duplicaten in RevControl veroorzaken. Bestaande vermeldingen worden niet bijgewerkt. Wil je hetzelfde bestand? Download het bij Eerdere exports.</p>}
    <fieldset disabled={locked} className="export-selection"><legend className="visually-hidden">Events per hotel</legend>
      {reexport && ready.length > 0 && <label className="export-row-toggle export-select-all"><input type="checkbox" checked={ready.every(({ key }) => selected.includes(key))} onChange={(e) => setSelected(e.target.checked ? [...new Set([...selected, ...ready.map(({ key }) => key)])] : selected.filter((key) => !ready.some((row) => row.key === key)))} />Alle {ready.length} events selecteren</label>}
      {eventTable(ready)}
      {!ready.length && <div className="export-empty"><h3>{reexport ? "Geen beschikbare events" : "Je bent bij"}</h3><p className="muted">{reexport ? "Kies een ander hotel of een ruimere periode." : "Er staan geen nieuwe events klaar voor deze hotels en periode."}</p></div>}
      {announcements.length > 0 && <details className="export-disclosure export-optional"><summary>Optioneel toevoegen <span className="muted">· {announcements.length} {announcements.length === 1 ? "aankondiging" : "aankondigingen"}{choices.length > 0 ? ` · ${choices.length} toegevoegd` : ""}</span></summary><p className="muted">Deze events hebben nog geen onderbouwd vraagniveau. Kies zelf een niveau om ze mee te nemen. Dit verandert onze vraaginschatting niet.</p>{eventTable(announcements, true)}</details>}
    </fieldset>
    {workbookRows.length > 0 && <details className="export-disclosure export-file-details">
      <summary>Bekijk bestandsdetails</summary>
      <p className="muted">{workbookRows.length} Excel-rijen. Piek wordt in RevControl als Hoog geëxporteerd.</p>
      <div className="table-wrap"><table><thead><tr><th>Event</th><th>Start</th><th>Einde</th><th>Niveau</th><th>Hotelcodes</th></tr></thead><tbody>{workbookRows.slice(0, 20).map((row, index) => <tr key={index}><td>{row.event}</td><td>{row.startDate.toISOString().slice(0, 10)}</td><td>{row.endDate.toISOString().slice(0, 10)}</td><td>{demandLabels[row.importance]}</td><td>{row.hotels}</td></tr>)}</tbody></table>{workbookRows.length > 20 && <p>Het voorbeeld toont de eerste 20 rijen.</p>}</div>
    </details>}
    <div className="export-action-bar">
      <div className="export-action-summary"><strong>{preview.length} {preview.length === 1 ? "event" : "events"} klaar voor export</strong><span className="muted"> · {hotelIds.length} {hotelIds.length === 1 ? "hotel" : "hotels"}</span>
        {notice && <p role="status">{notice}</p>}
        {error && <p role="alert">{error}</p>}
        {download && <p role="status">Bestand aangemaakt. Importeer het in RevControl. <a href={download}>Opnieuw downloaden</a></p>}
      </div>
      <button className="primary export-submit" type="button" onClick={create} disabled={locked || !workbookRows.length}>{busy ? "Bestand maken…" : refreshing ? "Selectie bijwerken…" : reexport ? "Bewust opnieuw exporteren" : "Download voor RevControl"}</button>
    </div>
  </section>;
}
