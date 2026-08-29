import { cookies } from "next/headers";

import { createServerClient } from "@/lib/supabase/server";

export const SELECTED_HOTEL_COOKIE = "hotelrevpar_selected_hotel";

export async function getHotelScope(accountId: string, requestedHotelId?: string) {
  const supabase = await createServerClient();
  const { data: hotels, error: hotelError } = await supabase
    .from("hotels")
    .select("id, name")
    .eq("account_id", accountId)
    .order("name");
  if (hotelError) throw hotelError;

  const storedHotelId = (await cookies()).get(SELECTED_HOTEL_COOKIE)?.value;
  const candidate = requestedHotelId ?? storedHotelId;
  const selectedHotelId = hotels.some((hotel) => hotel.id === candidate) ? candidate! : hotels[0]?.id ?? null;
  if (!selectedHotelId) return { supabase, hotels, selectedHotelId, areaId: null };

  const { data: area, error: areaError } = await supabase
    .from("collection_areas")
    .select("id")
    .eq("account_id", accountId)
    .eq("hotel_id", selectedHotelId)
    .maybeSingle();
  if (areaError) throw areaError;
  return { supabase, hotels, selectedHotelId, areaId: area?.id ?? null };
}
