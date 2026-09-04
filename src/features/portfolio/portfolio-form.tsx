"use client";

import { useActionState, useEffect, useRef } from "react";

import { AddressCombobox } from "./address-combobox";
import { saveHotel, type FormState } from "./actions";
import type { DashboardHotel } from "@/features/dashboard/query";
import { selectHotel } from "@/features/workspace/actions";
import type { Hotel } from "./queries";

const sources = [
  ["rijksoverheid", "Rijksoverheid"],
  ["openholidays", "OpenHolidays"],
  ["ticketmaster", "Ticketmaster"],
  ["predicthq", "PredictHQ"],
  ["claude", "Claude webaanvulling"],
  ["footballdata", "Champions League"],
] as const;

function FieldError({ state, name }: { state: FormState; name: string }) {
  const message = state.errors?.[name]?.[0];
  return message ? <small className="field-error">{message}</small> : null;
}

function HotelEditor({
  hotel,
  isPlatformAdmin,
  onSaved,
}: {
  hotel?: Hotel;
  isPlatformAdmin: boolean;
  onSaved: () => void;
}) {
  const [state, action, pending] = useActionState(saveHotel, {});
  useEffect(() => {
    if (state.saved) onSaved();
  }, [state.saved, onSaved]);

  return (
    <form action={action} className="hotel-form">
      {hotel && <input name="id" type="hidden" value={hotel.id} />}
      <fieldset>
        <legend>Hotel</legend>
        <div className="form-grid">
          <label>
            Naam
            <input name="name" defaultValue={hotel?.name} required />
            <FieldError state={state} name="name" />
          </label>
          <AddressCombobox
            defaultAddress={hotel?.address ?? ""}
            defaultAddressId={hotel?.pdok_address_id ?? ""}
            error={state.errors?.addressId?.[0] ?? state.errors?.address?.[0]}
          />
        </div>
      </fieldset>
      <fieldset>
        <legend>Vraaggebied</legend>
        <div className="form-grid">
          <label>
            Zoekstraal rond het hotel (km)
            <input
              name="demandRadiusKm"
              type="number"
              min="1"
              max="250"
              defaultValue={hotel?.demand_radius_km ?? 25}
              required
            />
            <FieldError state={state} name="demandRadiusKm" />
          </label>
          <label>
            Vakantieregio
            <select
              name="holidayRegion"
              defaultValue={hotel?.holiday_region ?? ""}
            >
              <option value="">Geen</option>
              <option value="north">Noord</option>
              <option value="middle">Midden</option>
              <option value="south">Zuid</option>
            </select>
            <FieldError state={state} name="holidayRegion" />
          </label>
        </div>
      </fieldset>
      <fieldset>
        <legend>Export</legend>
        <label>
          RevControl-code
          <input
            name="revcontrolCode"
            defaultValue={hotel?.revcontrol_code}
            required
          />
          <FieldError state={state} name="revcontrolCode" />
        </label>
      </fieldset>
      {isPlatformAdmin && (
        <details className="source-settings">
          <summary>Bronnen beheren</summary>
          <fieldset className="checkbox-grid">
            <legend>Actieve bronnen</legend>
            {sources.map(([value, label]) => (
              <label key={value}>
                <input
                  name="enabledSources"
                  type="checkbox"
                  value={value}
                  defaultChecked={
                    hotel
                      ? hotel.enabled_sources.includes(value)
                      : value !== "predicthq"
                  }
                />
                {label}
              </label>
            ))}
            <FieldError state={state} name="enabledSources" />
          </fieldset>
        </details>
      )}
      {state.message && (
        <p className={state.saved ? "notice success" : "notice error"}>
          {state.message}
        </p>
      )}
      <div className="dialog-actions">
        <button className="primary" type="submit" disabled={pending}>
          {pending ? "Opslaan…" : "Hotel opslaan"}
        </button>
      </div>
    </form>
  );
}

function HotelDialog({
  hotel,
  isPlatformAdmin,
}: {
  hotel?: Hotel;
  isPlatformAdmin: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button
        className={hotel ? "secondary" : "primary"}
        type="button"
        onClick={() => dialogRef.current?.showModal?.()}
      >
        {hotel ? "Bewerken" : "Hotel toevoegen"}
      </button>
      <dialog
        className="hotel-dialog"
        ref={dialogRef}
        onClick={(event) => {
          if (event.target === dialogRef.current) dialogRef.current.close?.();
        }}
      >
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">Hotelinstellingen</span>
            <h2>{hotel ? hotel.name : "Hotel toevoegen"}</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Sluiten"
            onClick={() => dialogRef.current?.close?.()}
          >
            ×
          </button>
        </div>
        <HotelEditor
          hotel={hotel}
          isPlatformAdmin={isPlatformAdmin}
          onSaved={() => dialogRef.current?.close?.()}
        />
      </dialog>
    </>
  );
}

export function PortfolioForm({
  hotels,
  insights = [],
  isPlatformAdmin,
}: {
  hotels: Hotel[];
  insights?: DashboardHotel[];
  isPlatformAdmin: boolean;
}) {
  return (
    <section className="portfolio-list">
      <div className="portfolio-actions">
        <HotelDialog isPlatformAdmin={isPlatformAdmin} />
      </div>
      {!hotels.length ? (
        <p className="empty-state">Nog geen hotels toegevoegd.</p>
      ) : (
        <div className="hotel-cards">
          {hotels.map((hotel) => {
            const insight = insights.find((item) => item.id === hotel.id);
            return (
              <article className="hotel-card" key={hotel.id}>
                <div>
                  <h2>{hotel.name}</h2>
                  <p>{hotel.address}</p>
                </div>
                <span className={`run-status ${insight?.status ?? "idle"}`}>
                  {insight?.status === "running"
                    ? "Bezig"
                    : insight?.status === "attention"
                    ? "Aandacht nodig"
                    : "Actueel"}
                </span>
                <dl className="hotel-status-grid">
                  <div>
                    <dt>Volgend hoog moment</dt>
                    <dd>
                      {insight?.nextDemand ? (
                        <>
                          {insight.nextDemand.title}
                          <small>
                            {new Intl.DateTimeFormat("nl-NL", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            }).format(new Date(insight.nextDemand.startAt))}
                          </small>
                        </>
                      ) : (
                        "Nog geen"
                      )}
                    </dd>
                  </div>
                  {isPlatformAdmin && (
                    <div>
                      <dt>Datakwaliteit</dt>
                      <dd>{insight?.reviewCount ?? 0} in quarantaine</dd>
                    </div>
                  )}
                  <div>
                    <dt>Bijgewerkt</dt>
                    <dd>
                      {insight?.updatedAt
                        ? new Date(insight.updatedAt).toLocaleString("nl-NL", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })
                        : "Nog niet"}
                    </dd>
                  </div>
                  <div>
                    <dt>Zoekstraal</dt>
                    <dd>{hotel.demand_radius_km} km</dd>
                  </div>
                </dl>
                <div className="hotel-card-actions">
                  <form action={selectHotel}>
                    <input type="hidden" name="hotelId" value={hotel.id} />
                    <input type="hidden" name="destination" value="/calendar" />
                    <button className="primary" type="submit">
                      Kalender
                    </button>
                  </form>
                  <HotelDialog
                    hotel={hotel}
                    isPlatformAdmin={isPlatformAdmin}
                  />
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
