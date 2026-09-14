"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createCollectionRepository } from "@/features/collection/repository";
import { geocodeVenue } from "@/features/collection/sources/claude";
import { distanceKm } from "@/features/events/distance";
import { readEventEvidence } from "@/features/events/evidence";
import type { EventCandidate } from "@/features/events/types";
import { requirePlatformAdmin } from "@/lib/auth/require-account";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { createServerClient } from "@/lib/supabase/server";

const storedCandidateSchema = z.object({
  evidence: z.unknown().optional(),
  provider: z.enum([
    "rijksoverheid",
    "openholidays",
    "ticketmaster",
    "predicthq",
    "claude",
    "footballdata",
    "uefa",
  ]),
  providerEventId: z.string().min(1),
  sourceUrl: z.string(),
  publicSourceUrl: z.string().nullable().optional(),
  title: z.string(),
  category: z.string(),
  venue: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  regionScope: z.string().nullable(),
  startAt: z.string(),
  endAt: z.string(),
  sourceState: z.enum([
    "active",
    "predicted",
    "cancelled",
    "postponed",
    "removed",
  ]),
  providerDuplicateOfId: z.string().nullable().optional(),
  providerDeletedReason: z.string().nullable().optional(),
  providerCancelledAt: z.string().nullable().optional(),
  providerPostponedAt: z.string().nullable().optional(),
  certainty: z.enum(["confirmed", "provisional"]),
  localRank: z.number().nullable(),
  attendance: z.number().nullable(),
  venueCapacity: z.number().nullable(),
  aiImpactPoints: z.number().nullable().optional(),
  assessmentVersion: z.number().optional(),
  overnightAudience: z
    .enum(["none", "regional", "national", "international"])
    .nullable()
    .optional(),
  evidenceText: z.string().nullable(),
  primarySourceConfirmed: z.boolean(),
});

function readStoredCandidate(value: unknown): EventCandidate {
  const parsed = storedCandidateSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Opgeslagen eventgegevens zijn niet meer geldig.");
  }
  const { evidence: storedEvidence, ...candidate } = parsed.data;

  const evidence =
    storedEvidence === undefined ? undefined : readEventEvidence(storedEvidence);
  if (storedEvidence !== undefined && !evidence) {
    throw new Error("Opgeslagen eventgegevens zijn niet meer geldig.");
  }
  return { ...candidate, ...(evidence ? { evidence } : {}) };
}
type UnresolvedRowContext = {
  accountId: string;
  areaId: string;
  provider: string;
  providerEventId: string;
  row: {
    candidate: Json;
    resolved_at: string | null;
  };
};

async function unresolvedRow(formData: FormData) {
  const { accountId } = await requirePlatformAdmin();
  const areaId = String(formData.get("areaId") ?? "");
  const provider = String(formData.get("provider") ?? "");
  const providerEventId = String(formData.get("providerEventId") ?? "");
  const supabase = await createServerClient();
  const { data: area, error: areaError } = await supabase
    .from("collection_areas")
    .select("id")
    .eq("id", areaId)
    .eq("account_id", accountId)
    .maybeSingle();
  if (areaError) throw areaError;
  if (!area) throw new Error("Gebied niet gevonden in dit account.");

  const { data: row, error: rowError } = await supabase
    .from("unresolved_event_locations")
    .select("candidate, resolved_at")
    .eq("collection_area_id", areaId)
    .eq("provider", provider)
    .eq("provider_event_id", providerEventId)
    .maybeSingle();
  if (rowError) throw rowError;
  if (!row || row.resolved_at) {
    throw new Error("Deze melding is al afgehandeld.");
  }
  return {
    accountId,
    areaId,
    provider,
    providerEventId,
    row,
  } satisfies UnresolvedRowContext;
}

async function markResolved(
  context: UnresolvedRowContext,
  resolution: "published" | "dismissed",
) {
  const { error } = await createAdminClient()
    .from("unresolved_event_locations")
    .update({ resolved_at: new Date().toISOString(), resolution })
    .eq("collection_area_id", context.areaId)
    .eq("provider", context.provider)
    .eq("provider_event_id", context.providerEventId)
    .is("resolved_at", null);
  if (error) throw error;
}

export async function resolveEventLocation(formData: FormData): Promise<void> {
  const unresolved = await unresolvedRow(formData);
  const address = String(formData.get("address") ?? "").trim();
  if (address.length < 4) {
    throw new Error("Vul een adres in: straat, huisnummer en plaats.");
  }
  const location = await geocodeVenue(address);
  if (!location) {
    throw new Error("Adres niet gevonden. Gebruik straat, huisnummer en plaats.");
  }

  const candidate = readStoredCandidate(unresolved.row.candidate);
  candidate.latitude = location.latitude;
  candidate.longitude = location.longitude;
  if (candidate.evidence) {
    candidate.evidence.locationResolution = {
      query: address,
      method: "venue",
      latitude: location.latitude,
      longitude: location.longitude,
    };
  }

  const repository = createCollectionRepository();
  const context = await repository.loadContext(
    unresolved.accountId,
    unresolved.areaId,
  );
  // Publishing an address outside every hotel's own radius would create an event that can never
  // be scored above the radius ceiling, so say so and leave the row open for a correction.
  const withinRadius = context.hotels.some((hotel) =>
    distanceKm(hotel.latitude, hotel.longitude, location.latitude, location.longitude)
      <= hotel.demandRadiusKm);
  if (!withinRadius) {
    throw new Error("Dit adres ligt buiten het onderzoeksgebied van elk hotel in dit gebied.");
  }
  await repository.persistCandidate(context, candidate);
  await repository.recalculateScores(context);
  await markResolved(unresolved, "published");
  revalidatePath("/review");
  revalidatePath("/calendar");
}

export async function dismissEventLocation(formData: FormData): Promise<void> {
  const unresolved = await unresolvedRow(formData);
  await markResolved(unresolved, "dismissed");
  revalidatePath("/review");
}
