import { createServerClient } from "@/lib/supabase/server";
import { fetchAllRows, fetchInBatches } from "@/lib/supabase/fetch-in-batches";
import { currentExportSnapshot } from "./selection";
import type { ExportEvent, ExportSnapshot } from "./types";

export async function loadExportHistory(accountId: string, hotelIds: string[], current: ExportEvent[], page = 0) {
  const supabase = await createServerClient();
  const { data: batches, error } = await supabase.from("export_batches").select("id, created_at, selection").eq("account_id", accountId).or(hotelIds.map((id) => `selection->hotelIds.cs.["${id}"]`).join(",")).order("created_at", { ascending: false }).order("id").range(page * 20, page * 20 + 19);
  if (error) throw error;
  const claims = await fetchAllRows((from, to) => supabase.from("hotel_event_exports").select("*").eq("account_id", accountId).in("hotel_id", hotelIds).order("hotel_id").order("event_id").range(from, to));
  const ids = batches.map((batch) => batch.id);
  const items = ids.length ? await fetchAllRows((from, to) => supabase.from("export_items").select("*").eq("account_id", accountId).in("batch_id", ids).in("hotel_id", hotelIds).order("batch_id").order("hotel_id").order("event_id").range(from, to)) : [];
  return batches.map((batch) => ({ ...batch, items: items.filter((item) => item.batch_id === batch.id).map((item) => {
    const previous = item.snapshot as unknown as ExportSnapshot;
    const claim = claims.find((claim) => claim.hotel_id === item.hotel_id && claim.event_id === item.event_id);
    const canonicalId = claim?.canonical_event_id ?? item.event_id;
    const canonical = claims.find((entry) => entry.hotel_id === item.hotel_id && entry.event_id === canonicalId) ?? claim;
    const latest = canonical?.latest_batch_id === batch.id && canonical.latest_item_event_id === item.event_id;
    return { previous, latest, ...currentExportSnapshot(current.find((event) => event.id === canonicalId), item.hotel_id, previous) };
  }) }));
}

export async function calendarExportDates(accountId: string, hotelId: string | null) {
  if (!hotelId) return new Map<string, string>();
  const supabase = await createServerClient();
  const data = await fetchAllRows((from, to) => supabase.from("hotel_event_exports").select("event_id, latest_batch_id").eq("account_id", accountId).eq("hotel_id", hotelId).order("event_id").range(from, to));
  const ids = [...new Set(data.map((claim) => claim.latest_batch_id))];
  const batches = ids.length ? await fetchInBatches(ids, (ids) => supabase.from("export_batches").select("id, created_at").in("id", ids)) : [];
  return new Map(data.map((claim) => [claim.event_id, batches.find((batch) => batch.id === claim.latest_batch_id)!.created_at]));
}
