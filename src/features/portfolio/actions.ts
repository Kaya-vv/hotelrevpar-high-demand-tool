"use server";

import { revalidatePath } from "next/cache";

import { requireAccount } from "@/lib/auth/require-account";
import { createServerClient } from "@/lib/supabase/server";

import { collectionAreaInput, hotelInput } from "./schema";

export type FormState = {
  errors?: Record<string, string[]>;
  message?: string;
  saved?: boolean;
};

function errors(result: { error: { flatten: () => { fieldErrors: Record<string, string[]> } } }): FormState {
  return { errors: result.error.flatten().fieldErrors, message: "Controleer de gemarkeerde velden." };
}

export async function saveHotel(_state: FormState, formData: FormData): Promise<FormState> {
  const parsed = hotelInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return errors(parsed);

  const { accountId } = await requireAccount();
  const supabase = await createServerClient();
  const { id, ...hotel } = parsed.data;
  const row = {
    account_id: accountId,
    name: hotel.name,
    revcontrol_code: hotel.revcontrolCode,
    address: hotel.address || null,
    latitude: hotel.latitude,
    longitude: hotel.longitude,
    demand_radius_km: hotel.demandRadiusKm,
    holiday_region: hotel.holidayRegion,
  };
  const result = id
    ? await supabase.from("hotels").update(row).eq("id", id).eq("account_id", accountId)
    : await supabase.from("hotels").insert(row);

  if (result.error) return { message: result.error.message };
  revalidatePath("/portfolio");
  return { saved: true, message: "Hotel opgeslagen." };
}

export async function saveCollectionArea(_state: FormState, formData: FormData): Promise<FormState> {
  const raw = Object.fromEntries(formData);
  const parsed = collectionAreaInput.safeParse({ ...raw, enabledSources: formData.getAll("enabledSources") });
  if (!parsed.success) return errors(parsed);

  const { accountId } = await requireAccount();
  const supabase = await createServerClient();
  const { id, ...area } = parsed.data;
  const row = {
    account_id: accountId,
    name: area.name,
    latitude: area.latitude,
    longitude: area.longitude,
    radius_km: area.radiusKm,
    enabled_sources: area.enabledSources,
  };
  const result = id
    ? await supabase.from("collection_areas").update(row).eq("id", id).eq("account_id", accountId)
    : await supabase.from("collection_areas").insert(row);

  if (result.error) return { message: result.error.message };
  revalidatePath("/portfolio");
  return { saved: true, message: "Regio opgeslagen." };
}

