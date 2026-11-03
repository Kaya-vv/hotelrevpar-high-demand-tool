"use client";

import { useActionState } from "react";

import { createApiKey, type ApiKeyState } from "./actions";

export function ApiKeyForm() {
  const [state, action, pending] = useActionState(createApiKey, {} as ApiKeyState);
  return (
    <div>
      <form className="api-key-form" action={action}>
        <label>Naam<input name="name" required maxLength={60} placeholder="RevControl" /></label>
        <button className="secondary" type="submit" disabled={pending}>{pending ? "Even wachten…" : "Sleutel aanmaken"}</button>
      </form>
      {state.error && <p className="notice error">{state.error}</p>}
      {state.key && (
        <div className="notice success api-key-form">
          <strong>Kopieer deze sleutel nu. Je ziet hem hierna niet meer.</strong>
          <input value={state.key} readOnly onFocus={(event) => event.currentTarget.select()} />
          <button className="secondary" type="button" onClick={() => navigator.clipboard.writeText(state.key!)}>Kopiëren</button>
        </div>
      )}
    </div>
  );
}
