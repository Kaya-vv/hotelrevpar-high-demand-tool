"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { requireAccount } from "@/lib/auth/require-account";
import { createServerClient } from "@/lib/supabase/server";

import { SELECTED_HOTEL_COOKIE } from "./hotel-context";

const destinations = new Set(["/calendar", "/review", "/portfolio", "/export"]);

export async function selectHotel(formData: FormData) {
  const { accountId } = await requireAccount();
  const hotelId = String(formData.get("hotelId") ?? "");
  const requestedDestination = String(
    formData.get("destination") ?? "/calendar"
  );
  const destination = destinations.has(requestedDestination)
    ? requestedDestination
    : "/calendar";
  const { data, error } = await (await createServerClient())
    .from("hotels")
    .select("id")
    .eq("id", hotelId)
    .eq("account_id", accountId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Hotel niet gevonden in dit account.");

  (await cookies()).set(SELECTED_HOTEL_COOKIE, hotelId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 31_536_000,
  });
  redirect(destination);
}
