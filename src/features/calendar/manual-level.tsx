"use client";

import { useActionState } from "react";

import { demandLabels, demandLevels } from "@/features/events/importance";
import type { DemandLevel } from "@/features/events/importance";
import type { ManualLevelResult } from "@/features/review/actions";

export type ManualLevelAction = (
  previous: ManualLevelResult | null,
  formData: FormData,
) => Promise<ManualLevelResult>;

/**
 * Sets the demand level by hand for one hotel and one event. It sits on the event itself rather
 * than inside the collapsed explanation, and it always says what the save did: a level that
 * changes nothing visible is what made this control look broken.
 */
export function ManualLevelForm({
  eventId,
  hotelId,
  manualLevel,
  automaticLevel,
  action,
}: {
  eventId: string;
  hotelId: string;
  manualLevel: DemandLevel | null;
  automaticLevel: DemandLevel;
  action: ManualLevelAction;
}) {
  const [result, save, saving] = useActionState(action, null);
  return (
    <section className="manual-level">
      <h3>Inschatting aanpassen</h3>
      <p className="muted">
        Hoog en Piek gaan automatisch mee in de export. Medium gaat alleen mee als
        je het op de exportpagina selecteert. Laag zie je alleen als “Ook
        Laag-events tonen” aan staat.
      </p>
      <form action={save}>
        <input type="hidden" name="eventId" value={eventId} />
        <input type="hidden" name="hotelId" value={hotelId} />
        <label>
          Handmatige inschatting
          {/* Keyed on the saved level so a completed save shows what the database now holds. */}
          <select
            key={manualLevel ?? "automatic"}
            name="importance"
            defaultValue={manualLevel ?? automaticLevel}
          >
            {demandLevels.map((level) => (
              <option key={level} value={level}>
                {demandLabels[level]}
              </option>
            ))}
          </select>
        </label>
        <button className="secondary" type="submit" disabled={saving}>
          {saving ? "Opslaan…" : "Opslaan"}
        </button>
      </form>
      {result && (
        <p
          role="status"
          className={`notice ${result.ok ? "success" : "error"}`}
        >
          {result.message}
        </p>
      )}
    </section>
  );
}
