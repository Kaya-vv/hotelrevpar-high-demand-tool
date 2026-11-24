import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

import type { ExportMinLevel } from "./types";

export const exportMinLevelLabels: Record<ExportMinLevel, string> = {
  Medium: "Medium, Hoog en Piek",
  High: "Alleen Hoog en Piek",
  Low: "Ook Laag",
};

export type ExportSettings = { minLevel: ExportMinLevel; publicHolidays: boolean; schoolHolidays: boolean };

/** What this account sends to RevControl, in the Excel export and through the API. */
export async function loadExportSettings(client: SupabaseClient<Database>, accountId: string): Promise<ExportSettings> {
  const { data, error } = await client.from("accounts")
    .select("export_min_level, export_public_holidays, export_school_holidays").eq("id", accountId).single();
  if (error) throw error;
  return { minLevel: data.export_min_level, publicHolidays: data.export_public_holidays, schoolHolidays: data.export_school_holidays };
}
