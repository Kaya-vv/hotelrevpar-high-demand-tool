import { type NextRequest, NextResponse } from "next/server";

import { SELECTED_HOTEL_COOKIE } from "@/features/workspace/hotel-context";
import { requireAccount } from "@/lib/auth/require-account";
import { createServerClient } from "@/lib/supabase/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ hotelId: string }> },
) {
  const account = await requireAccount();
  const { hotelId } = await params;
  const hotels = (await createServerClient())
    .from("hotels")
    .select("id")
    .is("archived_at", null)
    .eq("id", hotelId);
  // The platform administrator may also open a subscriber's hotel to look at its calendar.
  const { data, error } = account.role === "platform_admin"
    ? await hotels.maybeSingle()
    : await hotels.eq("account_id", account.accountId).maybeSingle();
  if (error) throw error;
  if (!data) return new Response(null, { status: 404 });

  const response = NextResponse.redirect(new URL("/calendar", request.url));
  response.cookies.set(SELECTED_HOTEL_COOKIE, hotelId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 31_536_000,
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
