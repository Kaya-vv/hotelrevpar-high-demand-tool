"use client";

import { useActionState } from "react";

import { RefreshButton } from "@/components/refresh-button";

import { refreshHotel, type RefreshState } from "./actions";

const initialState: RefreshState = {};

export function RefreshHotelForm({ hotelId }: { hotelId: string }) {
  const [state, action] = useActionState(refreshHotel, initialState);

  return (
    <div className="refresh-hotel">
      <form action={action}>
        <input name="hotelId" type="hidden" value={hotelId} />
        <RefreshButton />
      </form>
      {state.message && <p className={`notice ${state.error ? "error" : "success"}`}>{state.message}</p>}
    </div>
  );
}
