"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { demandLabels, demandLevels, isPublishableDemand, type DemandLevel } from "../events/importance";
import { eventLocalDate } from "../events/normalize";
import { mapRevControlRows } from "./map-rows";
import { pairKey, selectExportEvents } from "./selection";
import type { ExportEvent, ExportMode } from "./types";

export function ExportControls({ events, hotelIds, hotelNames, from, to }: {
  events: ExportEvent[]; hotelIds: string[]; hotelNames: Record<string, string>; from: string; to: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<ExportMode>("new");
  const [selected, setSelected] = useState<string[]>([]);
  const [levels, setLevels] = useState<Record<string, DemandLevel>>(() => Object.fromEntries(events.flatMap((event) => event.hotels.flatMap((hotel) => hotel.exportLevel ? [[pairKey(event.id, hotel.id), hotel.exportLevel]] : []))));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [download, setDownload] = useState("");
  const pending = useRef<{ signature: string; key: string } | null>(null);
  const rows = events.flatMap((event) => event.hotels.filter((hotel) => hotel.available !== false && (hotel.announced || isPublishableDemand(hotel.importance, hotel.impactBasis))).map((hotel) => ({ event, hotel, key: pairKey(event.id, hotel.id) })));
  const choices = rows.filter(({ hotel, key }) => hotel.announced && selected.includes(key) && levels[key]).map(({ event, hotel, key }) => ({ eventId: event.id, hotelId: hotel.id, importance: levels[key] }));
  const effectivePairs = selected.filter((key) => rows.some((row) => row.key === key && (mode !== "new" || !row.hotel.exportedAt)));
  const effectiveChoices = choices.filter((choice) => effectivePairs.includes(pairKey(choice.eventId, choice.hotelId)));
  const preview = selectExportEvents(events, mode, effectivePairs, effectiveChoices);
  const workbookRows = mapRevControlRows(preview, hotelIds);
  const missingLevel = rows.some(({ hotel, key }) => hotel.announced && effectivePairs.includes(key) && !levels[key]);

  async function create() {
    if (busy) return;
    setBusy(true); setError(""); setDownload("");
    const body = { from, to, hotelIds, mode, selectedPairs: effectivePairs, choices: effectiveChoices };
    const signature = JSON.stringify(body);
    if (pending.current?.signature !== signature) pending.current = { signature, key: crypto.randomUUID() };
    try {
      const response = await fetch("/api/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, requestKey: pending.current.key }) });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 409) { pending.current = null; router.refresh(); }
        throw new Error(result.error ?? "Export maken mislukt. Probeer opnieuw.");
      }
      setDownload(result.url);
      window.location.assign(result.url);
      router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Download mislukt. Probeer opnieuw met dezelfde selectie."); }
    finally { setBusy(false); }
  }
  return <section className="panel export-preview">
    <h2>Exportselectie</h2>
    <p className="muted">{rows.filter(({ hotel }) => !hotel.exportedAt && !hotel.announced).length} nieuwe hotel-events · {rows.filter(({ hotel }) => hotel.exportedAt).length} eerder geëxporteerd · {rows.filter(({ hotel }) => hotel.announced && !hotel.exportedAt && !hotel.exportLevel).length} aankondigingen wachten op een exportniveau</p>
    <label className="export-mode">Exportmodus <select disabled={busy} value={mode} onChange={(event) => { setMode(event.target.value as ExportMode); setSelected([]); }}>
      <option value="new">Alleen niet eerder geëxporteerde events</option>
      <option value="selected">Geselecteerde events opnieuw exporteren</option>
      <option value="all">Alle beschikbare events opnieuw exporteren</option>
    </select></label>
    {mode !== "new" && <p className="notice error">Opnieuw importeren kan duplicaten in RevControl veroorzaken. Deze export werkt bestaande RevControl-events niet bij.</p>}
    <p className="muted">Aankondigingen worden alleen meegenomen als je ze aanvinkt en zelf een exportniveau kiest. Dit wijzigt onze vraaginschatting niet.</p>
    <fieldset disabled={busy} className="export-selection"><legend className="visually-hidden">Events per hotel</legend>
      {hotelIds.map((hotelId) => {
        const hotelRows = rows.filter(({ hotel }) => hotel.id === hotelId);
        if (!hotelRows.length) return null;
        return <section className="export-hotel-group" key={hotelId} aria-label={hotelNames[hotelId]}>
          <h3>{hotelNames[hotelId]} <span className="muted">· {hotelRows.length} events</span></h3>
          <div className="table-wrap"><table><thead><tr><th>Event</th><th>Periode</th><th>Selectie / exportniveau</th><th>Status</th></tr></thead><tbody>
            {hotelRows.map(({ event, hotel, key }) => {
              const disabled = mode === "new" && Boolean(hotel.exportedAt);
              return <tr key={key}>
                <td>{event.title}</td>
                <td>{eventLocalDate(event.startAt)} – {eventLocalDate(event.endAt)}</td>
                <td><div className="export-row-choice">
                  {hotel.announced || mode === "selected" ? <label className="export-row-toggle"><input aria-label={`Selecteer ${event.title} voor ${hotelNames[hotel.id]}`} type="checkbox" checked={selected.includes(key)} disabled={disabled} onChange={(e) => setSelected(e.target.checked ? [...selected, key] : selected.filter((item) => item !== key))} /><span className={hotel.announced ? "visually-hidden" : ""}>{hotel.announced ? "Selecteren" : demandLabels[hotel.importance]}</span></label> : <span>{disabled ? "—" : `${demandLabels[hotel.importance]} · Automatisch`}</span>}
                  {hotel.announced && <label><span className="visually-hidden">Handmatig exportniveau</span><select aria-label={`Exportniveau ${event.title} voor ${hotelNames[hotel.id]}`} disabled={disabled} value={levels[key] ?? ""} onChange={(e) => setLevels({ ...levels, [key]: e.target.value as DemandLevel })}><option value="">Kies een exportniveau</option>{demandLevels.map((level) => <option key={level} value={level}>{demandLabels[level]}</option>)}</select></label>}
                </div></td>
                <td>{hotel.exportedAt ? `Geëxporteerd ${new Date(hotel.exportedAt).toLocaleDateString("nl-NL")}` : hotel.announced ? "Aangekondigd · handmatig niveau" : "Nieuw"}</td>
              </tr>;
            })}
          </tbody></table></div>
        </section>;
      })}
    </fieldset>
    <details className="export-disclosure">
      <summary>Bekijk Excel-voorbeeld <span className="muted">· {workbookRows.length} Excel-rijen</span></summary>
      <p>Dit zijn de uiteindelijke Excel-rijen, inclusief hotelcodes. Piek wordt in RevControl als Hoog geëxporteerd.</p>
    {workbookRows.length > 0 && <div className="table-wrap"><table><thead><tr><th>Event</th><th>Start</th><th>Einde</th><th>Niveau</th><th>Hotelcodes</th></tr></thead><tbody>{workbookRows.slice(0, 20).map((row, index) => <tr key={index}><td>{row.event}</td><td>{row.startDate.toISOString().slice(0, 10)}</td><td>{row.endDate.toISOString().slice(0, 10)}</td><td>{demandLabels[row.importance]}</td><td>{row.hotels}</td></tr>)}</tbody></table>{workbookRows.length > 20 && <p>Het voorbeeld toont de eerste 20 rijen.</p>}</div>}
      {!workbookRows.length && <p>Geen events geselecteerd voor export.</p>}
    </details>
    {!rows.length && <p>Geen beschikbare events voor deze selectie.</p>}
    <div className="export-action-bar">
      <div className="export-action-summary"><strong>{preview.length} events geselecteerd · {workbookRows.length} Excel-rijen</strong>
    {missingLevel && <p role="status">Kies een exportniveau voor iedere geselecteerde aankondiging.</p>}
    {error && <p role="alert">{error}</p>}
    {download && <p role="status">Export opgeslagen. <a href={download}>Bestand opnieuw downloaden</a></p>}
      </div>
    <button className="primary export-submit" type="button" onClick={create} disabled={busy || missingLevel || !workbookRows.length}>{busy ? "Export wordt opgeslagen…" : mode === "new" ? "Nieuwe events exporteren" : "Bewust opnieuw exporteren"}</button>
    </div>
  </section>;
}
