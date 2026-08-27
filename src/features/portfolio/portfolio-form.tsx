"use client";

import { useActionState } from "react";

import { saveCollectionArea, saveHotel, type FormState } from "./actions";
import type { CollectionArea, Hotel } from "./queries";

const sources = [
  ["rijksoverheid", "Rijksoverheid"],
  ["openholidays", "OpenHolidays"],
  ["ticketmaster", "Ticketmaster"],
  ["predicthq", "PredictHQ"],
  ["claude", "Claude webaanvulling"],
] as const;

function FieldError({ state, name }: { state: FormState; name: string }) {
  const message = state.errors?.[name]?.[0];
  return message ? <small className="field-error">{message}</small> : null;
}

function HotelEditor({ hotel }: { hotel?: Hotel }) {
  const [state, action, pending] = useActionState(saveHotel, {});

  return (
    <form action={action} className="form-grid">
      {hotel && <input name="id" type="hidden" value={hotel.id} />}
      <label>Naam<input name="name" defaultValue={hotel?.name} required /><FieldError state={state} name="name" /></label>
      <label>RevControl-code<input name="revcontrolCode" defaultValue={hotel?.revcontrol_code} required /><FieldError state={state} name="revcontrolCode" /></label>
      <label className="wide">Adres<input name="address" defaultValue={hotel?.address ?? ""} /><FieldError state={state} name="address" /></label>
      <label>Latitude<input name="latitude" type="number" step="any" defaultValue={hotel?.latitude} required /><FieldError state={state} name="latitude" /></label>
      <label>Longitude<input name="longitude" type="number" step="any" defaultValue={hotel?.longitude} required /><FieldError state={state} name="longitude" /></label>
      <label>Vraagstraal (km)<input name="demandRadiusKm" type="number" min="1" max="250" defaultValue={hotel?.demand_radius_km ?? 25} required /><FieldError state={state} name="demandRadiusKm" /></label>
      <label>Vakantieregio<select name="holidayRegion" defaultValue={hotel?.holiday_region ?? ""}><option value="">Geen</option><option value="north">Noord</option><option value="middle">Midden</option><option value="south">Zuid</option></select><FieldError state={state} name="holidayRegion" /></label>
      {state.message && <p className={state.saved ? "notice success wide" : "notice error wide"}>{state.message}</p>}
      <button className="primary" type="submit" disabled={pending}>Hotel opslaan</button>
    </form>
  );
}

function AreaEditor({ area }: { area?: CollectionArea }) {
  const [state, action, pending] = useActionState(saveCollectionArea, {});

  return (
    <form action={action} className="form-grid">
      {area && <input name="id" type="hidden" value={area.id} />}
      <label className="wide">Naam<input name="name" defaultValue={area?.name} required /><FieldError state={state} name="name" /></label>
      <label>Latitude<input name="latitude" type="number" step="any" defaultValue={area?.latitude} required /><FieldError state={state} name="latitude" /></label>
      <label>Longitude<input name="longitude" type="number" step="any" defaultValue={area?.longitude} required /><FieldError state={state} name="longitude" /></label>
      <label className="wide">Zoekstraal (km)<input name="radiusKm" type="number" min="1" max="250" defaultValue={area?.radius_km ?? 30} required /><FieldError state={state} name="radiusKm" /></label>
      <fieldset className="wide checkbox-grid">
        <legend>Bronnen</legend>
        {sources.map(([value, label]) => <label key={value}><input name="enabledSources" type="checkbox" value={value} defaultChecked={area ? area.enabled_sources.includes(value) : true} />{label}</label>)}
        <FieldError state={state} name="enabledSources" />
      </fieldset>
      {state.message && <p className={state.saved ? "notice success wide" : "notice error wide"}>{state.message}</p>}
      <button className="primary" type="submit" disabled={pending}>Regio opslaan</button>
    </form>
  );
}

export function PortfolioForm({ hotels, areas }: { hotels: Hotel[]; areas: CollectionArea[] }) {
  return (
    <div className="portfolio-grid">
      <section className="panel">
        <h2>Hotel toevoegen</h2>
        <HotelEditor />
        <div className="saved-list">
          {hotels.map((hotel) => (
            <details key={hotel.id}>
              <summary aria-label={`Hotel ${hotel.name} bewerken`}><strong>{hotel.name}</strong><span>{hotel.revcontrol_code} · {hotel.demand_radius_km} km</span></summary>
              <HotelEditor hotel={hotel} />
            </details>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Regio toevoegen</h2>
        <AreaEditor />
        <div className="saved-list">
          {areas.map((area) => (
            <details key={area.id}>
              <summary aria-label={`Regio ${area.name} bewerken`}><strong>{area.name}</strong><span>{area.radius_km} km · {area.enabled_sources.length} bronnen</span></summary>
              <AreaEditor area={area} />
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
