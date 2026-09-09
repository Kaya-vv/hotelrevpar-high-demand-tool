import { requireAccount } from "@/lib/auth/require-account";
import { getHotelScope } from "@/features/workspace/hotel-context";
import { getCollectionStatus } from "@/features/collection/status";

export async function GET(request: Request) {
  const account = await requireAccount();
  const platform =
    new URL(request.url).searchParams.get("scope") === "platform";
  if (platform && account.role !== "platform_admin")
    return Response.json({ error: "Geen toegang" }, { status: 403 });
  const scope = await getHotelScope(account.accountId);
  return Response.json(
    await getCollectionStatus(account.accountId, scope.areaId, platform),
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
