"use server";

import { revalidatePath } from "next/cache";

import { requireAccount } from "@/lib/auth/require-account";
import { createServerClient } from "@/lib/supabase/server";

import { runCollection } from "./run";

export async function refreshAllAreas() {
  const { accountId } = await requireAccount();
  const { data: areas, error } = await (await createServerClient())
    .from("collection_areas")
    .select("id")
    .eq("account_id", accountId)
    .order("name");
  if (error) throw error;
  for (const area of areas) await runCollection({ accountId, areaId: area.id, trigger: "manual" });
  revalidatePath("/calendar");
  revalidatePath("/review");
}

