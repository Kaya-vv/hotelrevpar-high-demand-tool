import { runCollection } from "@/features/collection/run";

export const maxDuration = 300;

type CronDependencies = {
  secret: string | undefined;
  listAreas: () => Promise<Array<{ id: string; accountId: string }>>;
  run: (input: { accountId: string; areaId: string; trigger: "cron" }) => Promise<unknown>;
};

export function createCronHandler(dependencies: CronDependencies) {
  return async (request: Request) => {
    if (!dependencies.secret || request.headers.get("authorization") !== `Bearer ${dependencies.secret}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const runs = [];
    for (const area of await dependencies.listAreas()) {
      runs.push(await dependencies.run({ accountId: area.accountId, areaId: area.id, trigger: "cron" }));
    }
    return Response.json({ runs });
  };
}

export async function GET(request: Request) {
  return createCronHandler({
    secret: process.env.CRON_SECRET,
    run: runCollection,
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

