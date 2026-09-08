import { requireAccount } from "@/lib/auth/require-account";
import { createServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const { accountId } = await requireAccount();
  const { batchId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(batchId)) return new Response(null, { status: 404 });
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("export_batches").select("workbook").eq("account_id", accountId).eq("id", batchId).maybeSingle();
  if (error) throw error;
  if (!data) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(Buffer.from(data.workbook.slice(2), "hex")), { headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="events-${batchId}.xlsx"`,
    "Cache-Control": "private, no-store",
  } });
}
