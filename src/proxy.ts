import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { loginDestination } from "@/lib/auth/login-destination";

export function isPublicPath(pathname: string) {
  // These routes carry their own secret or signature instead of a login session.
  return pathname === "/login" || pathname === "/api/cron/collect" || pathname === "/api/queues/collect-hotel"
    || pathname === "/api/webhooks/plugandpay";
}

// The address users knew before app.demandradar.nl. Pages move to the current address, but /api
// stays: Vercel's daily search job calls this host and silently stops on a redirect.
const LEGACY_HOST = "demandradar-nu.vercel.app";

export function legacyRedirect(url: URL, siteUrl: string | undefined) {
  if (url.hostname !== LEGACY_HOST || url.pathname.startsWith("/api/") || !siteUrl) return null;
  const base = /^https?:\/\//i.test(siteUrl) ? siteUrl : `https://${siteUrl}`;
  const target = new URL(`${url.pathname}${url.search}`, base);
  return target.hostname === url.hostname ? null : target;
}

export async function proxy(request: NextRequest) {
  const moved = legacyRedirect(request.nextUrl, process.env.NEXT_PUBLIC_SITE_URL);
  if (moved) return NextResponse.redirect(moved);
  if (isPublicPath(request.nextUrl.pathname)) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (values) => {
          values.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    const destination = loginDestination(request.nextUrl.pathname);
    if (destination !== "/calendar") url.searchParams.set("next", destination);
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|DemandRadar-Logo.png|auth).*)"],
};
