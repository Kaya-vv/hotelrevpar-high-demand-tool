import { buildRevControlWorkbook } from "@/features/export/build-workbook";
import { mapRevControlRows } from "@/features/export/map-rows";
import { loadExportEvents } from "@/features/export/query";
import { requireAccount } from "@/lib/auth/require-account";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { accountId } = await requireAccount();
  const url = new URL(request.url);
  const selectedHotelIds = [...new Set(url.searchParams.getAll("hotel"))];
  const includeProvisional = url.searchParams.get("includeProvisional") === "1";
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(url.searchParams.get("month") ?? "")
    ? url.searchParams.get("month")!
    : new Date().toISOString().slice(0, 7);
  if (!selectedHotelIds.length) return Response.json({ error: "Kies minstens één hotel." }, { status: 400 });

  let events;
  try {
    ({ events } = await loadExportEvents(accountId, month, selectedHotelIds, includeProvisional));
  } catch (error) {
    if (error instanceof Error && error.message.includes("hoort niet bij dit account")) {
      return Response.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
  const buffer = await buildRevControlWorkbook(mapRevControlRows(events, selectedHotelIds));
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="events-${month}.xlsx"`,
    },
  });
}
