import { requireAccount } from "@/lib/auth/require-account";
import { createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { createExport, ExportConflict, exportRequestSchema } from "@/features/export/create";
import { loadExportEvents } from "@/features/export/query";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { accountId, userId } = await requireAccount();
  const parsed = exportRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Controleer hotels, periode en exportkeuzes." }, { status: 400 });
  const supabase = await createServerClient();
  try {
    const id = await createExport(parsed.data, {
      find: async (key) => {
        const { data, error } = await supabase.from("export_batches").select("id, request_hash").eq("account_id", accountId).eq("request_key", key).maybeSingle();
        if (error) throw error;
        return data;
      },
      load: async (input) => (await loadExportEvents(accountId, { start: input.from, end: input.to }, input.hotelIds)).events,
      commit: async (input, hash, bytes, items) => {
        const { data, error } = await createAdminClient().rpc("commit_hotel_export", {
          p_account: accountId, p_user: userId, p_key: input.requestKey, p_hash: hash,
          p_selection: input as Json, p_workbook: bytes.toString("base64"), p_items: items as unknown as Json,
          p_choices: input.choices as Json,
        });
        if (error?.code === "P0001") throw new ExportConflict("De selectie is intussen geëxporteerd of gewijzigd. Vernieuw het voorbeeld.");
        if (error) throw error;
        return data;
      },
    });
    return Response.json({ id, url: `/api/export/${id}` });
  } catch (error) {
    if (error instanceof ExportConflict) return Response.json({ error: error.message }, { status: 409 });
    if ((error as { code?: string }).code === "42501" || (error instanceof Error && error.message.includes("hoort niet bij dit account"))) {
      return Response.json({ error: "Geen toegang tot deze selectie." }, { status: 403 });
    }
    throw error;
  }
}
