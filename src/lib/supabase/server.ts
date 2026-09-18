import { createServerClient as createSsrClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import type { Database } from "./database.types";

/** The Supabase client of the signed-in user: row level security decides what it may read and write. */
export type ServerClient = SupabaseClient<Database>;

export async function createServerClient(): Promise<ServerClient> {
  const store = await cookies();

  return createSsrClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (values) => {
          try {
            values.forEach(({ name, value, options }) => store.set(name, value, options));
          } catch {
            // Server Components cannot write cookies. src/proxy.ts refreshes them.
          }
        },
      },
    },
  );
}
