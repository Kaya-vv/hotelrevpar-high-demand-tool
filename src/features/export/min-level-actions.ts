"use server";

import { revalidatePath } from "next/cache";

import { requireAccount } from "@/lib/auth/require-account";
import { createAdminClient } from "@/lib/supabase/admin";

export async function saveExportMinLevel(formData: FormData) {
  const { accountId } = await requireAccount();
  const level = formData.get("level");
  if (level !== "Low" && level !== "Medium" && level !== "High") throw new Error("Onbekend exportniveau.");
  const { error } = await createAdminClient().from("accounts").update({ export_min_level: level }).eq("id", accountId);
  if (error) throw error;
  revalidatePath("/export");
}
