import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

import type { ExportMinLevel } from "./types";

export const exportMinLevelLabels: Record<ExportMinLevel, string> = {
  Medium: "Medium, Hoog en Piek",
  High: "Alleen Hoog en Piek",
  Low: "Ook Laag",
};

/** The lowest level this account sends to RevControl, in the Excel export and through the API. */
export async function loadExportMinLevel(client: SupabaseClient<Database>, accountId: string): Promise<ExportMinLevel> {
  const { data, error } = await client.from("accounts").select("export_min_level").eq("id", accountId).single();
  if (error) throw error;
  return data.export_min_level;
}
