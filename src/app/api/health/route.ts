import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// Polled by an outside uptime monitor. The login page answers 200 even when the database is down,
// so this route touches the database and the login service and answers 503 if either fails.
export async function GET() {
  const [database, login] = await Promise.all([databaseUp(), loginServiceUp()]);
  const ok = database && login;
  return Response.json({ ok, database, login }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}

async function databaseUp() {
  try {
    const { error } = await createAdminClient().from("hotels").select("id").limit(1)
      .abortSignal(AbortSignal.timeout(10_000));
    return !error;
  } catch {
    return false;
  }
}

async function loginServiceUp() {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY! },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}
