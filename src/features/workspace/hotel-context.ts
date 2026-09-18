import { cache } from "react";
import { cookies } from "next/headers";

import type { CurrentAccount } from "@/lib/auth/require-account";
import { createServerClient } from "@/lib/supabase/server";

export const SELECTED_HOTEL_COOKIE = "demandradar_selected_hotel";

/** One option in the hotel switcher. The account name labels it while the platform administrator sees subscriber hotels too. */
export type SelectableHotel = {
  id: string;
  name: string;
  accountId: string;
  accountName: string;
};

/**
 * The hotels the signed-in user may open. Subscribers get their own hotels; the platform
 * administrator also gets every active subscriber's hotels so it can look at their calendar.
 */
export async function listSelectableHotels(account: {
  accountId: string;
  accountName: string;
  role: CurrentAccount["role"];
}): Promise<SelectableHotel[]> {
  const supabase = await createServerClient();
  if (account.role !== "platform_admin") {
    const { data, error } = await supabase
      .from("hotels")
      .select("id, name")
      .eq("account_id", account.accountId)
      .is("archived_at", null)
      .order("name");
    if (error) throw error;
    return data.map((hotel) => ({
      id: hotel.id,
      name: hotel.name,
      accountId: account.accountId,
      accountName: account.accountName,
    }));
  }

  const [hotelResult, accountResult] = await Promise.all([
    supabase.from("hotels").select("id, name, account_id").is("archived_at", null).order("name"),
    supabase.from("accounts").select("id, name").eq("active", true),
  ]);
  if (hotelResult.error) throw hotelResult.error;
  if (accountResult.error) throw accountResult.error;
  const accountNames = new Map(accountResult.data.map((row) => [row.id, row.name]));
  return hotelResult.data
    .filter((hotel) => accountNames.has(hotel.account_id))
    .map((hotel) => ({
      id: hotel.id,
      name: hotel.name,
      accountId: hotel.account_id,
      accountName: accountNames.get(hotel.account_id)!,
    }))
    .sort(
      (left, right) =>
        Number(right.accountId === account.accountId) - Number(left.accountId === account.accountId) ||
        left.accountName.localeCompare(right.accountName, "nl") ||
        left.name.localeCompare(right.name, "nl"),
    );
}

export const getHotelScope = cache(async function getHotelScope(accountId: string, requestedHotelId?: string) {
  const supabase = await createServerClient();
  const { data: hotels, error: hotelError } = await supabase
    .from("hotels")
    .select("id, name, demand_radius_km")
    .eq("account_id", accountId).is("archived_at", null)
    .order("name");
  if (hotelError) throw hotelError;

  const storedHotelId = (await cookies()).get(SELECTED_HOTEL_COOKIE)?.value;
  const candidate = requestedHotelId ?? storedHotelId;
  const selectedHotelId = hotels.some((hotel) => hotel.id === candidate) ? candidate! : hotels[0]?.id ?? null;
  if (!selectedHotelId) {
    return {
      supabase,
      hotels,
      selectedHotelId,
      areaId: null,
      enabledSources: [] as string[],
    };
  }

  const { data: area, error: areaError } = await supabase
    .from("collection_areas")
    .select("id, enabled_sources")
    .eq("account_id", accountId)
    .eq("hotel_id", selectedHotelId)
    .maybeSingle();
  if (areaError) throw areaError;
  return {
    supabase,
    hotels,
    selectedHotelId,
    areaId: area?.id ?? null,
    enabledSources: area?.enabled_sources ?? [],
  };
});
