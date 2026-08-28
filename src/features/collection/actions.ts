"use server";

import { revalidatePath } from "next/cache";

import { requireAccount } from "@/lib/auth/require-account";
import { createServerClient } from "@/lib/supabase/server";

import { runCollection } from "./run";

export type RefreshState = { message?: string; error?: boolean };

export async function refreshHotel(_state: RefreshState, formData: FormData): Promise<RefreshState> {
  const { accountId } = await requireAccount();
  const hotelId = String(formData.get("hotelId") ?? "");
  const { data: area, error } = await (await createServerClient())
    .from("collection_areas")
    .select("id")
    .eq("account_id", accountId)
    .eq("hotel_id", hotelId)
    .maybeSingle();
  if (error) throw error;
  if (!area) return { error: true, message: "Hotel niet gevonden in dit account." };

  let result: Awaited<ReturnType<typeof runCollection>>;
  try {
    result = await runCollection({ accountId, areaId: area.id, trigger: "manual" });
  } catch {
    return { error: true, message: "Bijwerken is mislukt. Probeer het later opnieuw." };
  }
  revalidatePath("/calendar");
  revalidatePath("/review");
  if (result.status === "already_running") return { message: "Dit hotel wordt al bijgewerkt." };

  const totals = Object.values(result.sourceResults).reduce<{ found: number; reviews: number }>(
    (sum, source) => {
      const value = source as { unique?: number; reviews?: number };
      return { found: sum.found + (value.unique ?? 0), reviews: sum.reviews + (value.reviews ?? 0) };
    },
    { found: 0, reviews: 0 },
  );
  return {
    error: result.status === "partial",
    message: `${totals.found} gebeurtenissen gevonden${totals.reviews ? `, ${totals.reviews} vragen aandacht` : ""}.${result.status === "partial" ? " Een bron kon niet worden bereikt." : ""}`,
  };
}

