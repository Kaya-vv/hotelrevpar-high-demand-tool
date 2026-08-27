"use server";

import { revalidatePath } from "next/cache";

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
  return { ...account, eventId, supabase, note: String(formData.get("note") ?? "").trim() || null };
}

function refreshViews() {
  revalidatePath("/calendar");
  revalidatePath("/review");
}

export async function acceptEvent(formData: FormData) {
  const context = await scopedEvent(formData);
  const { error } = await context.supabase
    .from("account_events")
    .update({ state: "active", review_reason: null, decided_at: new Date().toISOString(), decided_by: context.userId, operator_note: context.note })
    .eq("account_id", context.accountId)
    .eq("event_id", context.eventId);
  if (error) throw error;
  refreshViews();
}

export async function excludeEvent(formData: FormData) {
  const context = await scopedEvent(formData);
  const { error } = await context.supabase
    .from("account_events")
    .update({ state: "excluded", decided_at: new Date().toISOString(), decided_by: context.userId, operator_note: context.note })
    .eq("account_id", context.accountId)
    .eq("event_id", context.eventId);
  if (error) throw error;
  refreshViews();
}

export async function editEvent(formData: FormData) {
  const context = await scopedEvent(formData);
  const title = String(formData.get("title") ?? "").trim();
  const venue = String(formData.get("venue") ?? "").trim();
  const startAt = String(formData.get("startAt") ?? "");
  const endAt = String(formData.get("endAt") ?? "");
  if (!title || !startAt || !endAt || endAt < startAt) throw new Error("Controleer titel en datums.");
  const { error } = await context.supabase
    .from("account_events")
    .update({
      override_title: title,
      override_venue: venue || null,
      override_start_at: startAt,
      override_end_at: endAt,
      state: "active",
      review_reason: null,
      decided_at: new Date().toISOString(),
      decided_by: context.userId,
      operator_note: context.note,
    })
    .eq("account_id", context.accountId)
    .eq("event_id", context.eventId);
  if (error) throw error;
  refreshViews();
}

export async function mergeEvent(formData: FormData) {
  const context = await scopedEvent(formData);
  const targetEventId = String(formData.get("targetEventId") ?? "");
  const { data: target, error: targetError } = await context.supabase
    .from("account_events")
    .select("event_id")
    .eq("account_id", context.accountId)
    .eq("event_id", targetEventId)
    .maybeSingle();
  if (targetError) throw targetError;
  if (!target || targetEventId === context.eventId) throw new Error("Kies een ander event uit dit account.");
  const { error } = await context.supabase
    .from("account_events")
    .update({ state: "excluded", merged_into_event_id: targetEventId, decided_at: new Date().toISOString(), decided_by: context.userId, operator_note: context.note })
    .eq("account_id", context.accountId)
    .eq("event_id", context.eventId);
  if (error) throw error;
  refreshViews();
}

export async function overrideImportance(formData: FormData) {
  const context = await scopedEvent(formData);
  const hotelId = String(formData.get("hotelId") ?? "");
  const importance = String(formData.get("importance") ?? "");
  if (!["Low", "Medium", "High"].includes(importance)) throw new Error("Ongeldige importance.");
  const { data: hotel, error: hotelError } = await context.supabase
    .from("hotels")
    .select("id")
    .eq("id", hotelId)
    .eq("account_id", context.accountId)
    .maybeSingle();
  if (hotelError) throw hotelError;
  if (!hotel) throw new Error("Hotel niet gevonden in dit account.");
  const { error: scoreError } = await context.supabase
    .from("hotel_event_scores")
    .update({ importance_override: importance, override_note: context.note })
    .eq("hotel_id", hotelId)
    .eq("event_id", context.eventId);
  if (scoreError) throw scoreError;
  const { error: decisionError } = await context.supabase
    .from("account_events")
    .update({ decided_at: new Date().toISOString(), decided_by: context.userId, operator_note: context.note })
    .eq("account_id", context.accountId)
    .eq("event_id", context.eventId);
  if (decisionError) throw decisionError;
  refreshViews();
}

