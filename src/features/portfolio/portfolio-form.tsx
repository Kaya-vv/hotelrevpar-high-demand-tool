"use client";

import { useActionState } from "react";

import { AddressCombobox } from "./address-combobox";
import { saveHotel, type FormState } from "./actions";
import type { Hotel } from "./queries";

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
      <AddressCombobox
        defaultAddress={hotel?.address ?? ""}
        defaultAddressId={hotel?.pdok_address_id ?? ""}
        error={state.errors?.addressId?.[0] ?? state.errors?.address?.[0]}
      />
      <label>Vraagstraal (km)<input name="demandRadiusKm" type="number" min="1" max="250" defaultValue={hotel?.demand_radius_km ?? 25} required /><FieldError state={state} name="demandRadiusKm" /></label>
      <label>Vakantieregio<select name="holidayRegion" defaultValue={hotel?.holiday_region ?? ""}><option value="">Geen</option><option value="north">Noord</option><option value="middle">Midden</option><option value="south">Zuid</option></select><FieldError state={state} name="holidayRegion" /></label>
      <details className="wide source-settings">
        <summary>Bronnen</summary>
        <fieldset className="checkbox-grid">
          <legend>Actieve bronnen</legend>
          {sources.map(([value, label]) => <label key={value}><input name="enabledSources" type="checkbox" value={value} defaultChecked={hotel ? hotel.enabled_sources.includes(value) : true} />{label}</label>)}
          <FieldError state={state} name="enabledSources" />
        </fieldset>
      </details>
      {state.message && <p className={state.saved ? "notice success wide" : "notice error wide"}>{state.message}</p>}
      <button className="primary" type="submit" disabled={pending}>Hotel opslaan</button>
    </form>
  );
}

export function PortfolioForm({ hotels }: { hotels: Hotel[] }) {
  return (
    <div className="portfolio-grid single">
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
    </div>
  );
}
