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
    .select(
      "event_id, review_fingerprint, review_target_event_id, review_source_id"
    )
    .eq("account_id", account.accountId)
    .eq("event_id", eventId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Event niet gevonden in dit account.");
  return {
    automation_reason: null,
    ...account,
    ...data,
    eventId,
    supabase,
    note: String(formData.get("note") ?? "").trim() || null,
  };
}

function refreshViews() {
  revalidatePath("/calendar");
  revalidatePath("/review");
  revalidatePath("/export");
}

function resolution(context: Awaited<ReturnType<typeof scopedEvent>>) {
  return {
    review_reason: null,
    resolved_review_fingerprint: context.review_fingerprint,
    decided_at: new Date().toISOString(),
    decided_by: context.userId,
    operator_note: context.note,
  };
}

export async function acceptEvent(formData: FormData) {
  const context = await scopedEvent(formData);
  const { error } = await context.supabase
    .from("account_events")
    .update({ state: "active", ...resolution(context) })
    .eq("account_id", context.accountId)
    .eq("event_id", context.eventId);
  if (error) throw error;
  refreshViews();
}

export async function excludeEvent(formData: FormData) {
  const context = await scopedEvent(formData);
  const { error } = await context.supabase
    .from("account_events")
    .update({ state: "excluded", ...resolution(context) })
    .eq("account_id", context.accountId)
    .eq("event_id", context.eventId);
  if (error) throw error;
  refreshViews();
}

export async function keepCurrentEvent(formData: FormData) {
  const context = await scopedEvent(formData);
  const { data: event, error: eventError } = await context.supabase
    .from("events")
    .select("title, venue, start_at, end_at")
    .eq("id", context.eventId)
    .single();
  if (eventError) throw eventError;
  const { error } = await context.supabase
    .from("account_events")
    .update({
      state: "active",
      override_title: event.title,
      override_venue: event.venue,
      override_start_at: event.start_at,
      override_end_at: event.end_at,
      ...resolution(context),
    })
    .eq("account_id", context.accountId)
    .eq("event_id", context.eventId);
  if (error) throw error;
  refreshViews();
}

export async function applyReviewChange(formData: FormData) {
  const context = await scopedEvent(formData);
  if (!context.review_source_id)
    throw new Error("Nieuwe eventgegevens ontbreken.");
  const { data: source, error: sourceError } = await context.supabase
    .from("event_sources")
    .select(
      "extracted_title, extracted_location, extracted_start_at, extracted_end_at"
    )
    .eq("id", context.review_source_id)
    .single();
  if (sourceError) throw sourceError;
  const { error } = await context.supabase
    .from("account_events")
    .update({
      state: "active",
      override_title: source.extracted_title,
      override_venue: source.extracted_location,
      override_start_at: source.extracted_start_at,
      override_end_at: source.extracted_end_at ?? source.extracted_start_at,
      ...resolution(context),
    })
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
  if (!title || !startAt || !endAt || endAt < startAt)
    throw new Error("Controleer titel en datums.");
  const { error } = await context.supabase
    .from("account_events")
    .update({
      override_title: title,
      override_venue: venue || null,
      override_start_at: startAt,
      override_end_at: endAt,
      state: "active",
      ...resolution(context),
    })
    .eq("account_id", context.accountId)
    .eq("event_id", context.eventId);
  if (error) throw error;
  refreshViews();
}

export async function mergeEvent(formData: FormData) {
  const context = await scopedEvent(formData);
  const targetEventId = context.review_target_event_id;
  if (!targetEventId || targetEventId === context.eventId)
    throw new Error("Voorgesteld duplicaat ontbreekt.");
  const { error } = await context.supabase
    .from("account_events")
    .update({
      state: "excluded",
      merged_into_event_id: targetEventId,
      ...resolution(context),
    })
    .eq("account_id", context.accountId)
    .eq("event_id", context.eventId);
  if (error) throw error;
  refreshViews();
}

export async function overrideImportance(formData: FormData) {
  const context = await scopedEvent(formData);
  const hotelId = String(formData.get("hotelId") ?? "");
  const importance = String(formData.get("importance") ?? "");
  if (!["Low", "Medium", "High", "Peak"].includes(importance))
    throw new Error("Ongeldige inschatting.");
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
  refreshViews();
}
