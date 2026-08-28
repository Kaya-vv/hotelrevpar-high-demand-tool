"use server";

import { revalidatePath } from "next/cache";

import { requireAccount } from "@/lib/auth/require-account";
import { createServerClient } from "@/lib/supabase/server";

import { getAddressById } from "./geocode";
import { hotelInput } from "./schema";

export type FormState = {
  errors?: Record<string, string[]>;
  message?: string;
  saved?: boolean;
};

function errors(result: { error: { flatten: () => { fieldErrors: Record<string, string[]> } } }): FormState {
  return { errors: result.error.flatten().fieldErrors, message: "Controleer de gemarkeerde velden." };
}

export async function saveHotel(_state: FormState, formData: FormData): Promise<FormState> {
  const parsed = hotelInput.safeParse({
    ...Object.fromEntries(formData),
    enabledSources: formData.getAll("enabledSources"),
  });
  if (!parsed.success) return errors(parsed);

  const { accountId } = await requireAccount();
  let location: Awaited<ReturnType<typeof getAddressById>>;
  try {
    location = await getAddressById(parsed.data.addressId);
  } catch (error) {
    return {
      errors: { address: [error instanceof Error ? error.message : "Adres kon niet worden gecontroleerd."] },
      message: "Controleer het adres.",
    };
  }

  const supabase = await createServerClient();
  const { id, ...hotel } = parsed.data;
  const row = {
    account_id: accountId,
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
    ? await supabase.from("hotels").update(row).eq("id", id).eq("account_id", accountId)
    : await supabase.from("hotels").insert(row);

  if (result.error) return { message: result.error.message };
  revalidatePath("/portfolio");
  return { saved: true, message: "Hotel opgeslagen." };
}

