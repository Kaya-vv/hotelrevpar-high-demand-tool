import type { DemandLevel } from "@/features/events/importance";
import { createServerClient } from "@/lib/supabase/server";
import { fetchInBatches } from "@/lib/supabase/fetch-in-batches";

import type { ExportEvent } from "./types";

export function monthBounds(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const end = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
  return { start: `${month}-01`, end };
}

export async function loadExportEvents(accountId: string, month: string, selectedHotelIds: string[], includeProvisional = false) {
  const supabase = await createServerClient();
  const { data: hotels, error: hotelError } = await supabase
    .from("hotels")
    .select("id, name, revcontrol_code")
    .eq("account_id", accountId)
    .in("id", selectedHotelIds);
  if (hotelError) throw hotelError;
  if (hotels.length !== selectedHotelIds.length) throw new Error("Een geselecteerd hotel hoort niet bij dit account.");

  const { data: decisions, error: decisionError } = await supabase
    .from("account_events")
    .select("event_id, override_title, override_start_at, override_end_at")
    .eq("account_id", accountId)
    .eq("state", "active");
  if (decisionError) throw decisionError;
  const eventIds = decisions.map((decision) => decision.event_id);
  const bounds = monthBounds(month);
  const [exportEvents, scores] = eventIds.length
    ? await Promise.all([
        fetchInBatches(eventIds, (ids) => supabase.from("events").select("id, title, start_at, end_at, certainty").in("id", ids).lte("start_at", `${bounds.end}T23:59:59Z`).gte("end_at", `${bounds.start}T00:00:00Z`)),
        fetchInBatches(eventIds, (ids) => supabase.from("hotel_event_scores").select("event_id, hotel_id, suggested_importance, importance_override").in("event_id", ids).in("hotel_id", selectedHotelIds)),
      ])
    : [[], []];

  const decisionsByEvent = new Map(decisions.map((decision) => [decision.event_id, decision]));
  const hotelCodes = new Map(hotels.map((hotel) => [hotel.id, hotel.revcontrol_code]));
  const events: ExportEvent[] = exportEvents.filter((event) => includeProvisional || event.certainty === "confirmed").map((event) => {
    const decision = decisionsByEvent.get(event.id);
    return {
      id: event.id,
      title: decision?.override_title ?? event.title,
      startAt: decision?.override_start_at ?? event.start_at,
      endAt: decision?.override_end_at ?? event.end_at,
      hotels: scores
        .filter((score) => score.event_id === event.id)
        .map((score) => ({
          id: score.hotel_id,
          code: hotelCodes.get(score.hotel_id)!,
          importance: (score.importance_override ?? score.suggested_importance) as DemandLevel,
        })),
    };
  });
  return { hotels, events };
}
