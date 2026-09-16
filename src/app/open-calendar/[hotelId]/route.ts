import { type NextRequest, NextResponse } from "next/server";

import { SELECTED_HOTEL_COOKIE } from "@/features/workspace/hotel-context";
import { requireAccount } from "@/lib/auth/require-account";
import { createServerClient } from "@/lib/supabase/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ hotelId: string }> },
) {
  const { accountId } = await requireAccount();
  const { hotelId } = await params;
  const { data, error } = await (await createServerClient())
    .from("hotels")
    .select("id")
    .eq("account_id", accountId).is("archived_at", null)
    .eq("id", hotelId)
    .maybeSingle();
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
