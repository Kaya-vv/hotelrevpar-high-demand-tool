import { runCollection } from "@/features/collection/run";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: accounts, error: accountError } = await admin.from("accounts").select("id").eq("active", true);
  if (accountError) throw accountError;
  const accountIds = accounts.map((account) => account.id);
  if (!accountIds.length) return Response.json({ runs: [] });

  const { data: areas, error: areaError } = await admin
    .from("collection_areas")
    .select("id, account_id")
    .in("account_id", accountIds)
    .order("name");
  if (areaError) throw areaError;

  const runs = [];
  for (const area of areas) {
    runs.push(await runCollection({ accountId: area.account_id, areaId: area.id, trigger: "cron" }));
  }
  return Response.json({ runs });
}

