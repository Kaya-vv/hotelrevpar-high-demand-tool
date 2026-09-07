"use server";

import { revalidatePath } from "next/cache";

import { requirePlatformAdmin } from "@/lib/auth/require-account";
import { createServerClient } from "@/lib/supabase/server";

import { enqueueCollectionAreas, publishCollectionJob } from "./jobs";

export type RefreshState = {
  message?: string;
  error?: boolean;
  batchId?: string;
};

function resultMessage(
  result: Awaited<ReturnType<typeof enqueueCollectionAreas>>,
  allHotels = false
) {
  if (!result.queued && result.skipped)
    return allHotels
      ? "De hotels worden al bijgewerkt."
      : "Dit hotel wordt al bijgewerkt.";
  if (!result.queued && result.failed)
    return "Bijwerken kon niet worden gestart. Probeer het later opnieuw.";
  const subject = allHotels
    ? `${result.queued} hotel${result.queued === 1 ? "" : "s"}`
    : "Dit hotel";
  const skipped = result.skipped
    ? ` ${result.skipped} hotel${
        result.skipped === 1 ? " was" : "s waren"
      } al bezig.`
    : "";
  const failed = result.failed
    ? ` ${result.failed} opdracht${
        result.failed === 1 ? "" : "en"
      } kon niet starten.`
    : "";
  return `${subject} ${
    allHotels && result.queued !== 1 ? "worden" : "wordt"
  } op de achtergrond bijgewerkt.${skipped}${failed}`;
}

export async function refreshHotel(
  _state: RefreshState,
  formData: FormData
): Promise<RefreshState> {
  const { accountId, userId } = await requirePlatformAdmin();
  const hotelId = String(formData.get("hotelId") ?? "");
  const { data: area, error } = await (await createServerClient())
    .from("collection_areas")
    .select("id")
    .eq("account_id", accountId)
    .eq("hotel_id", hotelId)
    .maybeSingle();
  if (error) throw error;
  if (!area)
    return { error: true, message: "Hotel niet gevonden in dit account." };

  if (formData.get("operation") === "publication") {
    const { data: run, error } = await (await createServerClient()).from("collection_runs").select("id").eq("account_id", accountId).eq("collection_area_id", area.id).order("started_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    if (!run) return { error: true, message: "Er zijn nog geen opgeslagen resultaten." };
    // A new queue message targets this deployment; retries of an older message stay pinned.
    await publishCollectionJob({ kind: "market-publication", accountId, areaId: area.id, runId: run.id, requestedAt: new Date().toISOString() });
    return { message: "Opgeslagen resultaten worden gepubliceerd. Er wordt geen nieuw onderzoek gestart." };
  }

  let result: Awaited<ReturnType<typeof enqueueCollectionAreas>>;
  try {
    result = await enqueueCollectionAreas({
      accountId,
      areaIds: [area.id],
      trigger: "manual",
      createdBy: userId,
    });
  } catch {
    return {
      error: true,
      message: "Bijwerken is mislukt. Probeer het later opnieuw.",
    };
  }
  revalidatePath("/calendar");
  revalidatePath("/review");
  return {
    error: !result.queued && Boolean(result.failed),
    batchId: result.batchId,
    message: resultMessage(result),
  };
}

export async function refreshAllHotels(): Promise<RefreshState> {
  const { accountId, userId } = await requirePlatformAdmin();
  const { data: areas, error } = await (await createServerClient())
    .from("collection_areas")
    .select("id")
    .eq("account_id", accountId)
    .not("hotel_id", "is", null);
  if (error) throw error;
  if (!areas.length)
    return { error: true, message: "Voeg eerst een hotel toe." };

  try {
    const result = await enqueueCollectionAreas({
      accountId,
      areaIds: areas.map((area) => area.id),
      trigger: "manual",
      createdBy: userId,
    });
    revalidatePath("/calendar");
    revalidatePath("/review");
    return {
      error: !result.queued && Boolean(result.failed),
      batchId: result.batchId,
      message: resultMessage(result, true),
    };
  } catch {
    return {
      error: true,
      message: "Bijwerken is mislukt. Probeer het later opnieuw.",
    };
  }
}
