import { createEventsHandler } from "@/features/public-api/handlers";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = createEventsHandler({ client: createAdminClient });
