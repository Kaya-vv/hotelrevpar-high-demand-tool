"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requirePlatformAdmin } from "@/lib/auth/require-account";
import { createAdminClient } from "@/lib/supabase/admin";

const PAGE = "/admin/venue-calendars";

class VenueCalendarInputError extends Error {}

const calendarSchema = z.object({
  name: z.string().trim().min(1).max(200),
  url: z.url({ protocol: /^https$/ }).max(2_000),
  city: z.string().trim().min(1).max(100),
});

async function runVenueAction(success: string, operation: () => Promise<string | void>) {
  let notice = success;
  try {
    notice = (await operation()) ?? success;
  } catch (error) {
    notice = error instanceof VenueCalendarInputError ? error.message : "failed";
    console.error("Venue calendar action failed", { operation: success, notice, error: error instanceof Error ? error.message : "unknown" });
  }
  revalidatePath(PAGE);
  redirect(`${PAGE}?notice=${notice}`);
}

function calendarId(formData: FormData) {
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) throw new VenueCalendarInputError("missing");
  return id.data;
}

/** Adding a URL that is already listed updates that row instead of failing. */
export async function saveVenueCalendar(formData: FormData) {
  await requirePlatformAdmin();
  return runVenueAction("added", async () => {
    const text = (field: string) => String(formData.get(field) ?? "").trim();
    const parsed = calendarSchema.safeParse({ name: text("name"), url: text("url"), city: text("city") });
    if (!parsed.success) throw new VenueCalendarInputError("input");
    const admin = createAdminClient();
    const { data: existing, error: readError } = await admin.from("venue_calendars").select("id").eq("url", parsed.data.url).maybeSingle();
    if (readError) throw readError;
    // Coordinates are cleared so the next research run places the (possibly changed) city again.
    const { error } = await admin.from("venue_calendars").upsert({
      ...parsed.data, national: formData.get("national") === "on", active: true,
      latitude: null, longitude: null, updated_at: new Date().toISOString(),
    }, { onConflict: "url" });
    if (error) throw error;
    return existing ? "updated" : "added";
  });
}

export async function setVenueCalendarActive(formData: FormData) {
  await requirePlatformAdmin();
  const active = formData.get("active") === "true";
  return runVenueAction(active ? "switched-on" : "switched-off", async () => {
    const { data, error } = await createAdminClient().from("venue_calendars")
      .update({ active, updated_at: new Date().toISOString() }).eq("id", calendarId(formData)).select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw new VenueCalendarInputError("missing");
  });
}

/** Removing stops the weekly re-read; events already found from the page stay on the calendar. */
export async function removeVenueCalendar(formData: FormData) {
  await requirePlatformAdmin();
  return runVenueAction("removed", async () => {
    const { data, error } = await createAdminClient().from("venue_calendars")
      .delete().eq("id", calendarId(formData)).select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw new VenueCalendarInputError("missing");
  });
}
