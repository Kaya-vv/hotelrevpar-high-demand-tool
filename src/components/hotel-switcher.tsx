"use client";

import { useRef } from "react";

export function HotelSwitcher({
  hotels,
  selectedHotelId,
  action,
}: {
  hotels: Array<{ id: string; name: string }>;
  selectedHotelId: string | null;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  if (!hotels.length) return <span className="no-hotel">Nog geen hotel</span>;

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
        {hotels.map((hotel) => <option key={hotel.id} value={hotel.id}>{hotel.name}</option>)}
      </select>
      <button className="visually-hidden" type="submit">Hotel openen</button>
    </form>
  );
}
