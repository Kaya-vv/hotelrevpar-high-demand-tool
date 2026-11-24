"use server";

import { revalidatePath } from "next/cache";

import { requireAccount } from "@/lib/auth/require-account";
import { createAdminClient } from "@/lib/supabase/admin";

export async function saveExportSettings(formData: FormData) {
  const { accountId } = await requireAccount();
  const level = formData.get("level");
  if (level !== "Low" && level !== "Medium" && level !== "High") throw new Error("Onbekend exportniveau.");
  const { error } = await createAdminClient().from("accounts").update({
    export_min_level: level,
    export_public_holidays: formData.get("publicHolidays") === "on",
    export_school_holidays: formData.get("schoolHolidays") === "on",
  }).eq("id", accountId);
  if (error) throw error;
  revalidatePath("/export");
}
