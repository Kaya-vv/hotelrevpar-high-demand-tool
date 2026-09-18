"use client";

import { useRef } from "react";

import type { SelectableHotel } from "@/features/workspace/hotel-context";

export function HotelSwitcher({
  hotels,
  selectedHotelId,
  action,
}: {
  hotels: SelectableHotel[];
  selectedHotelId: string | null;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  if (!hotels.length) return <span className="no-hotel">Nog geen hotel</span>;

  // The platform administrator sees hotels of several accounts, so each account gets its own
  // labelled group. A subscriber only has one account and needs no grouping.
  const accounts = [...new Set(hotels.map((hotel) => hotel.accountId))];

  return (
    <form ref={formRef} action={action} className="hotel-switcher">
      <input type="hidden" name="destination" value="/calendar" />
      <label htmlFor="workspace-hotel">Actief hotel</label>
      <select
        id="workspace-hotel"
        name="hotelId"
        value={selectedHotelId ?? ""}
        onChange={() => formRef.current?.requestSubmit()}
      >
        {accounts.length > 1
          ? accounts.map((accountId) => {
              const owned = hotels.filter((hotel) => hotel.accountId === accountId);
              return (
                <optgroup key={accountId} label={owned[0].accountName}>
                  {owned.map((hotel) => (
                    <option key={hotel.id} value={hotel.id}>
                      {hotel.name}
                    </option>
                  ))}
                </optgroup>
              );
            })
          : hotels.map((hotel) => (
              <option key={hotel.id} value={hotel.id}>
                {hotel.name}
              </option>
            ))}
      </select>
      <button className="visually-hidden" type="submit">Hotel openen</button>
    </form>
  );
}
