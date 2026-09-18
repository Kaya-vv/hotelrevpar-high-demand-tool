import { requireViewedAccount } from "@/features/workspace/viewed-account";
import { getHotelScope } from "@/features/workspace/hotel-context";
import { getCollectionStatus } from "@/features/collection/status";

export async function GET(request: Request) {
  const account = await requireViewedAccount();
  const platform =
    new URL(request.url).searchParams.get("scope") === "platform";
  if (platform && account.role !== "platform_admin")
    return Response.json({ error: "Geen toegang" }, { status: 403 });
  const scope = await getHotelScope(account.viewedAccountId);
  return Response.json(
    await getCollectionStatus(account.viewedAccountId, scope.areaId, platform),
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
