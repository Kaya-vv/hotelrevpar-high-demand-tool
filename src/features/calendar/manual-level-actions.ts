"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import {
  demandLabels,
  demandLevels,
  type DemandLevel,
} from "@/features/events/importance";
import { requireAccount } from "@/lib/auth/require-account";
import { createServerClient } from "@/lib/supabase/server";

async function scopedEvent(formData: FormData) {
  const account = await requireAccount();
  const eventId = String(formData.get("eventId") ?? "");
  if (!eventId) throw new Error("Event ontbreekt.");
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("account_events")
    .select("event_id")
    .eq("account_id", account.accountId)
    .eq("event_id", eventId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Event niet gevonden in dit account.");
  return {
    ...account,
    eventId,
    supabase,
    note: String(formData.get("note") ?? "").trim() || null,
  };
}

/** What the calendar shows next to the save button. */
export type ManualLevelResult = { ok: boolean; message: string };

/**
 * Saves the hand-set demand level for one hotel and one event. It reports back instead of
 * throwing: a level that changed nothing on screen was indistinguishable from a dead button,
 * which is what the calendar looked like before.
 */
export async function overrideImportance(
  _previous: ManualLevelResult | null,
  formData: FormData,
): Promise<ManualLevelResult> {
  // Outside the try: an expired session must keep redirecting to the login page.
  await requireAccount();
  const hotelId = String(formData.get("hotelId") ?? "");
  const level = String(formData.get("importance") ?? "") as DemandLevel;
  if (!demandLevels.includes(level))
    return { ok: false, message: "Deze inschatting bestaat niet." };
  try {
    const context = await scopedEvent(formData);
    const { data: hotel, error: hotelError } = await context.supabase
      .from("hotels")
      .select("id")
      .eq("id", hotelId)
      .eq("account_id", context.accountId)
      .maybeSingle();
    if (hotelError) throw hotelError;
    if (!hotel)
      return { ok: false, message: "Dit hotel hoort niet bij dit account." };
    // `select` proves a row was written. Without it a filter that matches nothing - a rescored
    // event, another hotel - returns success and the screen simply never changes.
    const { data: saved, error: scoreError } = await context.supabase
      .from("hotel_event_scores")
      .update({ importance_override: level, override_note: context.note })
      .eq("hotel_id", hotelId)
      .eq("event_id", context.eventId)
      .select("hotel_id");
    if (scoreError) throw scoreError;
    if (!saved?.length)
      return {
        ok: false,
        message:
          "Niet opgeslagen: dit evenement heeft geen inschatting meer voor dit hotel. Werk de hotelgegevens bij en probeer het opnieuw.",
      };
    revalidatePath("/calendar");
    revalidatePath("/export");
    return {
      ok: true,
      message: `Opgeslagen. Inschatting staat nu op ${demandLabels[level]}.`,
    };
  } catch (error) {
    unstable_rethrow(error);
    console.error("overrideImportance", error);
    return {
      ok: false,
      message: "Opslaan is mislukt. Probeer het opnieuw.",
    };
  }
}
