import { enqueueCollectionAreas, type EnqueueResult } from "@/features/collection/jobs";
import { CHECK_INTERVAL_DAYS } from "@/features/collection/schedule";
import { fetchAllRows } from "@/lib/supabase/fetch-in-batches";

export const maxDuration = 300;

type CronDependencies = {
  secret: string | undefined;
  listAreas: () => Promise<Array<{ id: string; accountId: string }>>;
  enqueue: (input: { accountId: string; areaIds: string[]; trigger: "cron" }) => Promise<EnqueueResult>;
  enqueueNotifications?: () => Promise<{ queued: number }>;
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
    let notifications = { queued: 0 };
    if (dependencies.enqueueNotifications) {
      try {
        notifications = await dependencies.enqueueNotifications();
      } catch (error) {
        console.error("Pending event notifications could not be queued", {
          error: error instanceof Error ? error.name : "unknown",
        });
      }
    }
    return Response.json({ batches, notifications });
  };
}

export async function GET(request: Request) {
  return createCronHandler({
    secret: process.env.CRON_SECRET,
    enqueue: enqueueCollectionAreas,
    enqueueNotifications: async () => {
      const { enqueuePendingEventNotifications } = await import("@/features/notifications/service");
      return enqueuePendingEventNotifications();
    },
    listAreas: async () => {
      const { createAdminClient } = await import("@/lib/supabase/admin");
      const admin = createAdminClient();
      const { data: accounts, error: accountError } = await admin.from("accounts").select("id").eq("active", true);
      if (accountError) throw accountError;
      const accountIds = accounts.map((account) => account.id);
      if (!accountIds.length) return [];
      const { data: areas, error: areaError } = await admin
        .from("collection_areas")
        .select("id, account_id, hotels!inner(archived_at)").is("hotels.archived_at", null)
        .in("account_id", accountIds)
        .not("hotel_id", "is", null)
        .order("name");
      if (areaError) throw areaError;
      // The daily clock only queues hotels due for their fortnightly update. Manual
      // refreshes also count, so onboarding never buys another search the next morning.
      const cutoff = new Date();
      cutoff.setUTCDate(cutoff.getUTCDate() - CHECK_INTERVAL_DAYS + 1);
      const recent = await fetchAllRows((from, to) => admin.from("collection_runs")
        .select("id, collection_area_id")
        .gte("started_at", `${cutoff.toISOString().slice(0, 10)}T00:00:00Z`)
        .order("id").range(from, to));
      const refreshed = new Set(recent.map((run) => run.collection_area_id));
      return areas.filter((area) => !refreshed.has(area.id))
        .map((area) => ({ id: area.id, accountId: area.account_id }));
    },
  })(request);
}

