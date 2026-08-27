import type { EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

import { createServerClient } from "@/lib/supabase/server";

const otpTypes = new Set<EmailOtpType>(["email", "email_change", "invite", "magiclink", "recovery", "signup"]);

export function safeNextPath(value: string | null) {
  if (!value) return "/calendar";
  const base = "https://hotelrevpar.invalid";
  try {
    const target = new URL(value, base);
    return target.origin === base ? `${target.pathname}${target.search}${target.hash}` : "/calendar";
  } catch {
    return "/calendar";
  }
}

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;

  if (tokenHash && type && otpTypes.has(type)) {
    const supabase = await createServerClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) {
      return NextResponse.redirect(new URL(safeNextPath(request.nextUrl.searchParams.get("next")), request.url));
    }
  }

  return NextResponse.redirect(new URL("/login?error=invite", request.url));
}
