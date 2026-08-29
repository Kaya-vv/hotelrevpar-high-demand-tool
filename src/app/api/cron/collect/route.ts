import { enqueueCollectionAreas, type EnqueueResult } from "@/features/collection/jobs";

export const maxDuration = 300;

type CronDependencies = {
  secret: string | undefined;
  listAreas: () => Promise<Array<{ id: string; accountId: string }>>;
  enqueue: (input: { accountId: string; areaIds: string[]; trigger: "cron" }) => Promise<EnqueueResult>;
};

export function createCronHandler(dependencies: CronDependencies) {
  return async (request: Request) => {
    if (!dependencies.secret || request.headers.get("authorization") !== `Bearer ${dependencies.secret}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const areas = await dependencies.listAreas();
    const byAccount = new Map<string, typeof areas>();
    for (const area of areas) byAccount.set(area.accountId, [...(byAccount.get(area.accountId) ?? []), area]);
    const batches = await Promise.all(
      [...byAccount].map(([accountId, accountAreas]) =>
        dependencies.enqueue({ accountId, areaIds: accountAreas.map((area) => area.id), trigger: "cron" }),
      ),
    );
    return Response.json({ batches });
  };
}

export async function GET(request: Request) {
  return createCronHandler({
    secret: process.env.CRON_SECRET,
    enqueue: enqueueCollectionAreas,
    listAreas: async () => {
      const { createAdminClient } = await import("@/lib/supabase/admin");
      const admin = createAdminClient();
      const { data: accounts, error: accountError } = await admin.from("accounts").select("id").eq("active", true);
      if (accountError) throw accountError;
      const accountIds = accounts.map((account) => account.id);
      if (!accountIds.length) return [];
      const { data: areas, error: areaError } = await admin
        .from("collection_areas")
        .select("id, account_id")
        .in("account_id", accountIds)
        .not("hotel_id", "is", null)
        .order("name");
      if (areaError) throw areaError;
      return areas.map((area) => ({ id: area.id, accountId: area.account_id }));
    },
  })(request);
}

