"use client";

import { useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { exportPeriod } from "./display";

export function ExportFilters({ hotels, hotelIds, from, to, view, children }: {
  hotels: { id: string; name: string }[]; hotelIds: string[]; from: string; to: string; view: string; children: ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function update(form: HTMLFormElement) {
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const query = new URLSearchParams();
    data.forEach((value, key) => query.append(key, String(value)));
    startTransition(() => router.replace(`/export?${query}`, { scroll: false }));
  }
  return <>
    <details className="panel export-filter-panel">
      <summary><span><strong>{hotelIds.length === 1 ? hotels.find((hotel) => hotel.id === hotelIds[0])?.name : `${hotelIds.length} hotels`}</strong><span className="muted">{exportPeriod(from, to)}</span></span><span className="export-edit">Aanpassen</span></summary>
      <form className="export-settings" onSubmit={(event) => { event.preventDefault(); update(event.currentTarget); }}>
        <input type="hidden" name="selection" value="1" />
        <input type="hidden" name="view" value={view} />
        <div className="date-range">
          <label>Van<input key={`from-${from}`} disabled={pending} name="from" type="date" defaultValue={from} max={to} required onBlur={(event) => { if (event.target.value !== from) update(event.currentTarget.form!); }} /></label>
          <label>Tot en met<input key={`to-${to}`} disabled={pending} name="to" type="date" defaultValue={to} min={from} required onBlur={(event) => { if (event.target.value !== to) update(event.currentTarget.form!); }} /></label>
        </div>
        <fieldset className="checkbox-grid"><legend>Hotels</legend>{hotels.map((hotel) => <label key={`${hotel.id}-${hotelIds.includes(hotel.id)}`}><input disabled={pending} name="hotel" type="checkbox" value={hotel.id} defaultChecked={hotelIds.includes(hotel.id)} onChange={(event) => update(event.currentTarget.form!)} />{hotel.name}</label>)}</fieldset>
        <button type="submit" className="visually-hidden">Filters bijwerken</button>
      </form>
    </details>
    <div role="status" className="export-loading">{pending ? "Selectie bijwerken…" : ""}</div>
    <fieldset disabled={pending} aria-busy={pending} className="export-content">{children}</fieldset>
  </>;
}
