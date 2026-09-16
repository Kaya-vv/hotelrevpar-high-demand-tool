import { createServerClient } from "@/lib/supabase/server";

export type Hotel = {
  id: string;
  name: string;
  revcontrol_code: string;
  address: string | null;
  pdok_address_id: string | null;
  latitude: number;
  longitude: number;
  demand_radius_km: number;
  holiday_region: "north" | "middle" | "south" | null;
  enabled_sources: string[];
  archived_at?: string | null;
};

export async function getPortfolio(accountId: string, archived = false) {
  const supabase = await createServerClient();
  const query = supabase.from("hotels").select("*").eq("account_id", accountId).order("name");
  const hotelsResult = await (archived ? query.not("archived_at", "is", null) : query.is("archived_at", null));

  if (hotelsResult.error) throw hotelsResult.error;

  return { hotels: hotelsResult.data as Hotel[] };
}

