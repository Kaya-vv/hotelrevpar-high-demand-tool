"use client";

import { useActionState } from "react";

import { refreshAllHotels, type RefreshState } from "./actions";

export function RefreshAllForm() {
  const [state, action, pending] = useActionState(refreshAllHotels, {} as RefreshState);
  return (
    <div className="refresh-all">
      <form action={action}>
        <button className="primary" type="submit" disabled={pending}>
          {pending ? "Opdrachten starten…" : "Alle hotels bijwerken"}
        </button>
      </form>
      {state.message && <p className={`notice ${state.error ? "error" : "success"}`}>{state.message}</p>}
    </div>
  );
}
