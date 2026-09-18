"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { requireAccount } from "@/lib/auth/require-account";
import { createServerClient } from "@/lib/supabase/server";

import { SELECTED_HOTEL_COOKIE } from "./hotel-context";

const destinations = new Set(["/calendar", "/review", "/portfolio", "/export"]);

export async function selectHotel(formData: FormData) {
  const account = await requireAccount();
  const hotelId = String(formData.get("hotelId") ?? "");
  const requestedDestination = String(
    formData.get("destination") ?? "/calendar"
  );
  const destination = destinations.has(requestedDestination)
    ? requestedDestination
    : "/calendar";
  const supabase = await createServerClient();
  const hotels = supabase
    .from("hotels")
    .select("id, account_id")
    .eq("id", hotelId).is("archived_at", null);
  // The platform administrator may also open a subscriber's hotel to look at its calendar.
  const { data, error } = account.role === "platform_admin"
    ? await hotels.maybeSingle()
    : await hotels.eq("account_id", account.accountId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Hotel niet gevonden in dit account.");
  if (data.account_id !== account.accountId) {
    const { data: owner, error: ownerError } = await supabase
      .from("accounts")
      .select("id")
      .eq("id", data.account_id)
      .eq("active", true)
      .maybeSingle();
    if (ownerError) throw ownerError;
    if (!owner) throw new Error("Dit account is uitgeschakeld.");
  }

  (await cookies()).set(SELECTED_HOTEL_COOKIE, hotelId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 31_536_000,
  });
  redirect(destination);
}

/** Stops looking at a subscriber's hotel: the next page shows the administrator's own hotels again. */
export async function stopViewingOtherAccount() {
  await requireAccount();
  (await cookies()).delete(SELECTED_HOTEL_COOKIE);
  redirect("/calendar");
}
