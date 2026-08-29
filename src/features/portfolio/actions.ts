"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { enqueueCollectionAreas } from "@/features/collection/jobs";
import { SELECTED_HOTEL_COOKIE } from "@/features/workspace/hotel-context";
import { requireAccount } from "@/lib/auth/require-account";
import { createServerClient } from "@/lib/supabase/server";

import { getAddressById } from "./geocode";
import { hotelInput } from "./schema";

export type FormState = {
  errors?: Record<string, string[]>;
  message?: string;
  saved?: boolean;
};

function errors(result: {
  error: { flatten: () => { fieldErrors: Record<string, string[]> } };
}): FormState {
  return {
    errors: result.error.flatten().fieldErrors,
    message: "Controleer de gemarkeerde velden.",
  };
}

export async function saveHotel(
  _state: FormState,
  formData: FormData
): Promise<FormState> {
  const account = await requireAccount();
  const requestedId = String(formData.get("id") ?? "");
  const supabase = await createServerClient();
  const { data: existing, error: existingError } = requestedId
    ? await supabase
        .from("hotels")
        .select(
          "id, pdok_address_id, demand_radius_km, holiday_region, enabled_sources"
        )
        .eq("id", requestedId)
        .eq("account_id", account.accountId)
        .maybeSingle()
    : { data: null, error: null };
  if (existingError) throw existingError;
  if (requestedId && !existing)
    return { message: "Hotel niet gevonden in dit account." };

  const enabledSources =
    account.role === "platform_admin"
      ? formData.getAll("enabledSources")
      : existing?.enabled_sources ?? [
          "rijksoverheid",
          "openholidays",
          "ticketmaster",
          "predicthq",
          "claude",
          "uefa",
        ];
  const parsed = hotelInput.safeParse({
    ...Object.fromEntries(formData),
    enabledSources,
  });
  if (!parsed.success) return errors(parsed);

  let location: Awaited<ReturnType<typeof getAddressById>>;
  try {
    location = await getAddressById(parsed.data.addressId);
  } catch (error) {
    return {
      errors: {
        address: [
          error instanceof Error
            ? error.message
            : "Adres kon niet worden gecontroleerd.",
        ],
      },
      message: "Controleer het adres.",
    };
  }

  const { id, ...hotel } = parsed.data;
  const row = {
    account_id: account.accountId,
    name: hotel.name,
    revcontrol_code: hotel.revcontrolCode,
    address: location.address,
    pdok_address_id: hotel.addressId,
    latitude: location.latitude,
    longitude: location.longitude,
    search_location: location.locality,
    demand_radius_km: hotel.demandRadiusKm,
    holiday_region: hotel.holidayRegion,
    enabled_sources: hotel.enabledSources,
  };
  const result = id
    ? await supabase
        .from("hotels")
        .update(row)
        .eq("id", id)
        .eq("account_id", account.accountId)
        .select("id")
        .single()
    : await supabase.from("hotels").insert(row).select("id").single();

  if (result.error) return { message: result.error.message };
  const hotelId = result.data.id;
  const requiresCollection =
    !existing ||
    existing.pdok_address_id !== hotel.addressId ||
    existing.demand_radius_km !== hotel.demandRadiusKm ||
    existing.holiday_region !== hotel.holidayRegion ||
    existing.enabled_sources.join("|") !== hotel.enabledSources.join("|");
  if (requiresCollection) {
    const { data: area, error: areaError } = await supabase
      .from("collection_areas")
      .select("id")
      .eq("account_id", account.accountId)
      .eq("hotel_id", hotelId)
      .single();
    if (areaError)
      return {
        saved: true,
        message: "Hotel opgeslagen, maar bijwerken kon niet starten.",
      };
    try {
      const queued = await enqueueCollectionAreas({
        accountId: account.accountId,
        areaIds: [area.id],
        trigger: "manual",
        createdBy: account.userId,
      });
      if (!queued.queued && queued.failed)
        return {
          saved: true,
          message: "Hotel opgeslagen, maar bijwerken kon niet starten.",
        };
    } catch {
      return {
        saved: true,
        message: "Hotel opgeslagen, maar bijwerken kon niet starten.",
      };
    }
  }
  if (!existing) {
    (await cookies()).set(SELECTED_HOTEL_COOKIE, hotelId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 31_536_000,
    });
  }
  revalidatePath("/portfolio");
  revalidatePath("/calendar");
  return {
    saved: true,
    message: requiresCollection
      ? "Hotel opgeslagen en wordt bijgewerkt."
      : "Hotel opgeslagen.",
  };
}
