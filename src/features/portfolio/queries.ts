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
};

export async function getPortfolio(accountId: string) {
  const supabase = await createServerClient();
  const hotelsResult = await supabase.from("hotels").select("*").eq("account_id", accountId).order("name");

  if (hotelsResult.error) throw hotelsResult.error;

  return { hotels: hotelsResult.data as Hotel[] };
}

