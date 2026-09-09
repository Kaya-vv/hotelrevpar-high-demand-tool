import { z } from "zod";
import { requireAccount } from "@/lib/auth/require-account";
import { getSourceHealthRuns } from "@/features/accounts/source-health";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  void _request; // Next.js supplies the request before the route parameters.
  const account = await requireAccount();
  if (account.role !== "platform_admin")
    return Response.json({ error: "Geen toegang" }, { status: 403 });
  const { runId } = await params;
  if (!z.uuid().safeParse(runId).success)
    return Response.json({ error: "Ongeldige run" }, { status: 400 });
  const [run] = await getSourceHealthRuns(0, runId);
  if (!run)
    return Response.json({ error: "Run niet gevonden" }, { status: 404 });
  return Response.json(run, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
