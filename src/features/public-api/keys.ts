import { createHash, randomBytes } from "node:crypto";

import { trialExpired } from "@/features/accounts/trial";
import type { ExportMinLevel } from "@/features/export/types";
import type { AdminClient } from "@/lib/supabase/admin";

import { apiError, type ApiError } from "./respond";

export const API_KEY_PATTERN = /^dr_live_[A-Za-z0-9_-]{43}$/;

/** Keys are 256-bit random, so a plain SHA-256 is enough; a slow password hash adds nothing. */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const key = `dr_live_${randomBytes(32).toString("base64url")}`;
  return { key, prefix: key.slice(0, 12), hash: hashApiKey(key) };
}

export type ApiAccount = { accountId: string; trialEndsAt: string | null; exportMinLevel: ExportMinLevel };

const unauthorized = () => apiError(401, "unauthorized", "Missing, invalid or revoked API key.");

/**
 * The account behind a bearer key. The admin client bypasses `is_account_member()`, so the
 * active-account and unexpired-trial checks it makes are repeated here.
 */
export async function authenticateApiKey(authorization: string | null, client: AdminClient, now = new Date()): Promise<ApiAccount | ApiError> {
  const token = /^Bearer (\S+)$/.exec(authorization ?? "")?.[1];
  if (!token || !API_KEY_PATTERN.test(token)) return unauthorized();

  const { data: key, error } = await client.from("api_keys")
    .select("id, account_id, revoked_at").eq("key_hash", hashApiKey(token)).maybeSingle();
  if (error) throw error;
  if (!key || key.revoked_at !== null) return unauthorized();

  const { data: account, error: accountError } = await client.from("accounts")
    .select("active, trial_ends_at, export_min_level").eq("id", key.account_id).single();
  if (accountError) throw accountError;
  if (!account.active || (account.trial_ends_at !== null && trialExpired(account.trial_ends_at, now))) {
    return apiError(403, "account_inactive", "This DemandRadar account is not active.");
  }

  const { error: touchError } = await client.from("api_keys").update({ last_used_at: now.toISOString() }).eq("id", key.id);
  if (touchError) console.error("API key last_used_at update failed", { keyId: key.id });

  return { accountId: key.account_id, trialEndsAt: account.trial_ends_at, exportMinLevel: account.export_min_level };
}
