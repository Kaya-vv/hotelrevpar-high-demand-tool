import { cache } from "react";
import { cookies } from "next/headers";

import { requireAccount, type CurrentAccount } from "@/lib/auth/require-account";
import { createServerClient } from "@/lib/supabase/server";

import { SELECTED_HOTEL_COOKIE } from "./hotel-context";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ViewedAccount = CurrentAccount & {
  /** The account whose hotels are on screen. Differs from `accountId` only while the platform administrator looks at a subscriber. */
  viewedAccountId: string;
  viewedAccountName: string;
  /** True while the platform administrator looks at someone else's hotel. Everything on screen is then read-only. */
  viewingOtherAccount: boolean;
};

/**
 * Who is signed in, and whose hotel is on screen. The platform administrator can pick a
 * subscriber's hotel in the switcher to look at its calendar; everyone else always sees their
 * own account. Use `accountId` for anything that writes and `viewedAccountId` for anything
 * that reads, so looking at a subscriber can never change their data.
 */
export const requireViewedAccount = cache(async function requireViewedAccount(): Promise<ViewedAccount> {
  const account = await requireAccount();
  const own: ViewedAccount = {
    ...account,
    viewedAccountId: account.accountId,
    viewedAccountName: account.accountName,
    viewingOtherAccount: false,
  };
  if (account.role !== "platform_admin") return own;

  const selectedHotelId = (await cookies()).get(SELECTED_HOTEL_COOKIE)?.value;
  if (!selectedHotelId || !UUID.test(selectedHotelId)) return own;

  const supabase = await createServerClient();
  const { data: hotel, error: hotelError } = await supabase
    .from("hotels")
    .select("account_id")
    .eq("id", selectedHotelId)
    .is("archived_at", null)
    .maybeSingle();
  if (hotelError) throw hotelError;
  if (!hotel || hotel.account_id === account.accountId) return own;

  const { data: other, error: accountError } = await supabase
    .from("accounts")
    .select("name")
    .eq("id", hotel.account_id)
    .eq("active", true)
    .maybeSingle();
  if (accountError) throw accountError;
  if (!other) return own;

  return {
    ...account,
    viewedAccountId: hotel.account_id,
    viewedAccountName: other.name,
    viewingOtherAccount: true,
  };
});
