import { enqueueCollectionAreas } from "@/features/collection/jobs";
import { requirePlatformAdmin } from "@/lib/auth/require-account";
import { createServerClient } from "@/lib/supabase/server";

export async function POST(_request: Request, { params }: { params: Promise<{ areaId: string }> }) {
  const { accountId, userId } = await requirePlatformAdmin();
  const { areaId } = await params;
  const { data: area, error } = await (await createServerClient())
    .from("collection_areas")
    .select("id")
    .eq("id", areaId)
    .eq("account_id", accountId)
    .not("hotel_id", "is", null)
    .maybeSingle();
  if (error) throw error;
  if (!area) return Response.json({ error: "Regio niet gevonden." }, { status: 404 });

  const result = await enqueueCollectionAreas({ accountId, areaIds: [areaId], trigger: "manual", createdBy: userId });
  return Response.json({ batchId: result.batchId, queued: result.queued, skipped: result.skipped });
}

