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

export function PortfolioForm({ hotels, areas }: { hotels: Hotel[]; areas: CollectionArea[] }) {
  const [hotelState, hotelAction, hotelPending] = useActionState(saveHotel, {});
  const [areaState, areaAction, areaPending] = useActionState(saveCollectionArea, {});

  return (
    <div className="portfolio-grid">
      <section className="panel">
        <h2>Hotel toevoegen</h2>
        <form action={hotelAction} className="form-grid">
          <label>Naam<input name="name" required /><FieldError state={hotelState} name="name" /></label>
          <label>RevControl-code<input name="revcontrolCode" required /><FieldError state={hotelState} name="revcontrolCode" /></label>
          <label className="wide">Adres<input name="address" /><FieldError state={hotelState} name="address" /></label>
          <label>Latitude<input name="latitude" type="number" step="any" required /><FieldError state={hotelState} name="latitude" /></label>
          <label>Longitude<input name="longitude" type="number" step="any" required /><FieldError state={hotelState} name="longitude" /></label>
          <label>Vraagstraal (km)<input name="demandRadiusKm" type="number" min="1" max="250" defaultValue="25" required /><FieldError state={hotelState} name="demandRadiusKm" /></label>
          <label>Vakantieregio<select name="holidayRegion" defaultValue=""><option value="">Geen</option><option value="north">Noord</option><option value="middle">Midden</option><option value="south">Zuid</option></select><FieldError state={hotelState} name="holidayRegion" /></label>
          {hotelState.message && <p className={hotelState.saved ? "notice success wide" : "notice error wide"}>{hotelState.message}</p>}
          <button className="primary" type="submit" disabled={hotelPending}>Hotel opslaan</button>
        </form>
        <ul className="saved-list">
          {hotels.map((hotel) => <li key={hotel.id}><strong>{hotel.name}</strong><span>{hotel.revcontrol_code} · {hotel.demand_radius_km} km</span></li>)}
        </ul>
      </section>

      <section className="panel">
        <h2>Regio toevoegen</h2>
        <form action={areaAction} className="form-grid">
          <label className="wide">Naam<input name="name" required /><FieldError state={areaState} name="name" /></label>
          <label>Latitude<input name="latitude" type="number" step="any" required /><FieldError state={areaState} name="latitude" /></label>
          <label>Longitude<input name="longitude" type="number" step="any" required /><FieldError state={areaState} name="longitude" /></label>
          <label className="wide">Zoekstraal (km)<input name="radiusKm" type="number" min="1" max="250" defaultValue="30" required /><FieldError state={areaState} name="radiusKm" /></label>
          <fieldset className="wide checkbox-grid">
            <legend>Bronnen</legend>
            {sources.map(([value, label]) => <label key={value}><input name="enabledSources" type="checkbox" value={value} defaultChecked />{label}</label>)}
            <FieldError state={areaState} name="enabledSources" />
          </fieldset>
          {areaState.message && <p className={areaState.saved ? "notice success wide" : "notice error wide"}>{areaState.message}</p>}
          <button className="primary" type="submit" disabled={areaPending}>Regio opslaan</button>
        </form>
        <ul className="saved-list">
          {areas.map((area) => <li key={area.id}><strong>{area.name}</strong><span>{area.radius_km} km · {area.enabled_sources.length} bronnen</span></li>)}
        </ul>
      </section>
    </div>
  );
}

