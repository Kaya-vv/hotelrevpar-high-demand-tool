"use client";

import { useActionState } from "react";

import { RefreshButton } from "@/components/refresh-button";

import { refreshHotel, type RefreshState } from "./actions";

const initialState: RefreshState = {};

export function RefreshHotelForm({ hotelId }: { hotelId: string }) {
  const [state, action, pending] = useActionState(refreshHotel, initialState);

  return (
    <div className="refresh-hotel">
      <form action={action}>
        <input name="hotelId" type="hidden" value={hotelId} />
        <RefreshButton />
        <button type="submit" name="operation" value="publication" disabled={pending}>Opgeslagen resultaten publiceren</button>
      </form>
      {state.message && <p className={`notice ${state.error ? "error" : "success"}`}>{state.message}</p>}
    </div>
  );
}
