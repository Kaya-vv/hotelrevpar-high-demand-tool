import { createHash } from "node:crypto";
import { enqueueCollectionAreas, type EnqueueResult } from "@/features/collection/jobs";
import type { CollectionScope } from "@/features/collection/run";
import { unexpiredTrialFilter } from "@/features/accounts/trial";
import { ANNOUNCEMENT_SEARCH_DAYS } from "@/features/collection/schedule";
import { fetchAllRows, fetchPagedInBatches } from "@/lib/supabase/fetch-in-batches";

export const maxDuration = 300;

// Each hotel gets a fixed weekday (0..4 = Monday..Friday), so ten hotels do not all start on the
// same morning and collide with OpenAI's per-minute token limit.
const weekdaySlot = (areaId: string) =>
  Number.parseInt(createHash("sha256").update(areaId).digest("hex").slice(0, 8), 16) % 5;

type CronDependencies = {
  secret: string | undefined;
  listAreas: () => Promise<Array<{ id: string; accountId: string; scope: CollectionScope }>>;
  enqueue: (input: { accountId: string; areaIds: string[]; trigger: "cron"; scope: CollectionScope }) => Promise<EnqueueResult>;
  enqueueNotifications?: () => Promise<{ queued: number }>;
};

export function createCronHandler(dependencies: CronDependencies) {
  return async (request: Request) => {
    if (!dependencies.secret || request.headers.get("authorization") !== `Bearer ${dependencies.secret}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const areas = await dependencies.listAreas();
    const groups = new Map<string, typeof areas>();
    for (const area of areas) {
      const key = `${area.accountId}:${area.scope}`;
      groups.set(key, [...(groups.get(key) ?? []), area]);
    }
    const batches = await Promise.all(
      [...groups.values()].map((group) => dependencies.enqueue({
        accountId: group[0].accountId, areaIds: group.map((area) => area.id), trigger: "cron", scope: group[0].scope,
      })),
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
      const { data: accounts, error: accountError } = await admin.from("accounts").select("id").eq("active", true)
        .or(unexpiredTrialFilter());
      if (accountError) throw accountError;
      const accountIds = accounts.map((account) => account.id);
      if (!accountIds.length) return [];
      const { data: areas, error: areaError } = await admin
        .from("collection_areas")
        .select("id, account_id, enabled_sources, hotels!inner(archived_at)").is("hotels.archived_at", null)
        .in("account_id", accountIds)
        .not("hotel_id", "is", null)
        .order("name");
      if (areaError) throw areaError;
      // The daily clock queues each hotel's full search once a week; the run itself decides which
      // searches are due. Manual refreshes also count, so onboarding never buys another search the
      // next morning. The daily Ticketmaster check does not count: it is not a search.
      const cutoff = new Date();
      cutoff.setUTCDate(cutoff.getUTCDate() - ANNOUNCEMENT_SEARCH_DAYS + 1);
      const recent = await fetchAllRows((from, to) => admin.from("collection_runs")
        .select("id, collection_area_id")
        .eq("scope", "full")
        .gte("started_at", `${cutoff.toISOString().slice(0, 10)}T00:00:00Z`)
        .order("id").range(from, to));
      const refreshed = new Set(recent.map((run) => run.collection_area_id));
      const due = areas.filter((area) => !refreshed.has(area.id)).map((area) => area.id);
      // A hotel that was never searched starts at once, so onboarding never waits for its weekday.
      const searched = new Set((await fetchPagedInBatches(due, (ids, from, to) => admin.from("collection_runs")
        .select("id, collection_area_id").eq("scope", "full").in("collection_area_id", ids).order("id").range(from, to)))
        .map((run) => run.collection_area_id));
      // Saturday (5) and Sunday (-1) match no slot.
      const today = new Date().getUTCDay() - 1;
      return areas.flatMap((area): Array<{ id: string; accountId: string; scope: CollectionScope }> => {
        const accountId = area.account_id;
        if (!refreshed.has(area.id) && (!searched.has(area.id) || weekdaySlot(area.id) === today))
          return [{ id: area.id, accountId, scope: "full" }];
        // Every other hotel gets the free Ticketmaster check, weekends included: a stadium show
        // announced on a Thursday afternoon must not wait for the hotel's weekday.
        return area.enabled_sources.includes("ticketmaster") ? [{ id: area.id, accountId, scope: "ticketmaster" }] : [];
      });
    },
  })(request);
}

