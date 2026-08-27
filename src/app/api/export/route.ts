import { buildRevControlWorkbook } from "@/features/export/build-workbook";
import { mapRevControlRows } from "@/features/export/map-rows";
import type { ExportEvent } from "@/features/export/types";
import { requireAccount } from "@/lib/auth/require-account";
import { createServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function monthBounds(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const end = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
  return { start: `${month}-01`, end };
}

export async function GET(request: Request) {
  const { accountId } = await requireAccount();
  const url = new URL(request.url);
  const selectedHotelIds = [...new Set(url.searchParams.getAll("hotel"))];
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(url.searchParams.get("month") ?? "")
    ? url.searchParams.get("month")!
    : new Date().toISOString().slice(0, 7);
  if (!selectedHotelIds.length) return Response.json({ error: "Kies minstens één hotel." }, { status: 400 });

  const supabase = await createServerClient();
  const { data: hotels, error: hotelError } = await supabase
    .from("hotels")
    .select("id, revcontrol_code")
    .eq("account_id", accountId)
    .in("id", selectedHotelIds);
  if (hotelError) throw hotelError;
  if (hotels.length !== selectedHotelIds.length) {
    return Response.json({ error: "Een geselecteerd hotel hoort niet bij dit account." }, { status: 403 });
  }

  const { data: decisions, error: decisionError } = await supabase
    .from("account_events")
    .select("event_id, override_title, override_start_at, override_end_at")
    .eq("account_id", accountId)
    .eq("state", "active");
  if (decisionError) throw decisionError;
  const eventIds = decisions.map((decision) => decision.event_id);
  const bounds = monthBounds(month);
  const [eventResult, scoreResult] = eventIds.length
    ? await Promise.all([
        supabase.from("events").select("id, title, start_at, end_at").in("id", eventIds).lte("start_at", `${bounds.end}T23:59:59Z`).gte("end_at", `${bounds.start}T00:00:00Z`),
        supabase.from("hotel_event_scores").select("event_id, hotel_id, suggested_importance, importance_override").in("event_id", eventIds).in("hotel_id", selectedHotelIds),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (eventResult.error) throw eventResult.error;
  if (scoreResult.error) throw scoreResult.error;

  const decisionsByEvent = new Map(decisions.map((decision) => [decision.event_id, decision]));
  const hotelCodes = new Map(hotels.map((hotel) => [hotel.id, hotel.revcontrol_code]));
  const events: ExportEvent[] = eventResult.data.map((event) => {
    const decision = decisionsByEvent.get(event.id);
    return {
      id: event.id,
      title: decision?.override_title ?? event.title,
      startAt: decision?.override_start_at ?? event.start_at,
      endAt: decision?.override_end_at ?? event.end_at,
      hotels: scoreResult.data
        .filter((score) => score.event_id === event.id)
        .map((score) => ({
          id: score.hotel_id,
          code: hotelCodes.get(score.hotel_id)!,
          importance: (score.importance_override ?? score.suggested_importance) as "Low" | "Medium" | "High",
        })),
    };
  });
  const buffer = await buildRevControlWorkbook(mapRevControlRows(events, selectedHotelIds));
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="events-${month}.xlsx"`,
    },
  });
}
