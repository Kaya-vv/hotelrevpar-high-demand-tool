import { runCollection } from "@/features/collection/run";
import { requireAccount } from "@/lib/auth/require-account";
import { createServerClient } from "@/lib/supabase/server";

export const maxDuration = 300;

export async function POST(_request: Request, { params }: { params: Promise<{ areaId: string }> }) {
  const { accountId } = await requireAccount();
  const { areaId } = await params;
  const { data: area, error } = await (await createServerClient())
    .from("collection_areas")
    .select("id")
    .eq("id", areaId)
    .eq("account_id", accountId)
    .maybeSingle();
  if (error) throw error;
  if (!area) return Response.json({ error: "Regio niet gevonden." }, { status: 404 });

  return Response.json(await runCollection({ accountId, areaId, trigger: "manual" }));
}

