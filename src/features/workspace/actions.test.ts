import { beforeEach, expect, it, vi } from "vitest";

const jar = { set: vi.fn(), delete: vi.fn() };

vi.mock("next/headers", () => ({ cookies: async () => jar }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth/require-account", () => ({ requireAccount: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: vi.fn() }));

import { redirect } from "next/navigation";

import { requireAccount } from "@/lib/auth/require-account";
import { createServerClient, type ServerClient } from "@/lib/supabase/server";

import { selectHotel, stopViewingOtherAccount } from "./actions";

const SUBSCRIBER_HOTEL = "6f1d2c4e-1111-4222-8333-444455556666";

function signedIn(role: "operator" | "platform_admin") {
  vi.mocked(requireAccount).mockResolvedValue({
    accountId: "own-account",
    accountName: "Hotelrevpar",
    role,
    userId: "user-1",
  });
}

type Rows = { hotel?: { id: string; account_id: string } | null; account?: { id: string } | null };

function database(rows: Rows) {
  const filters: Array<[string, unknown]> = [];
  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {};
    builder.select = vi.fn(() => builder);
    builder.is = vi.fn(() => builder);
    builder.eq = vi.fn((column: string, value: unknown) => {
      filters.push([`${table}.${column}`, value]);
      return builder;
    });
    builder.maybeSingle = vi.fn(async () => ({
      data: table === "hotels" ? rows.hotel ?? null : rows.account ?? null,
      error: null,
    }));
    return builder;
  });
  vi.mocked(createServerClient).mockResolvedValue({ from } as unknown as ServerClient);
  return filters;
}

function form(hotelId: string) {
  const data = new FormData();
  data.set("hotelId", hotelId);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
});

it("lets the administrator open a subscriber hotel", async () => {
  signedIn("platform_admin");
  const filters = database({
    hotel: { id: SUBSCRIBER_HOTEL, account_id: "subscriber-account" },
    account: { id: "subscriber-account" },
  });

  await selectHotel(form(SUBSCRIBER_HOTEL));

  expect(jar.set).toHaveBeenCalledWith("demandradar_selected_hotel", SUBSCRIBER_HOTEL, expect.anything());
  expect(redirect).toHaveBeenCalledWith("/calendar");
  expect(filters).not.toContainEqual(["hotels.account_id", "own-account"]);
  expect(filters).toContainEqual(["accounts.active", true]);
});

it("refuses a hotel of a switched-off account", async () => {
  signedIn("platform_admin");
  database({ hotel: { id: SUBSCRIBER_HOTEL, account_id: "subscriber-account" }, account: null });

  await expect(selectHotel(form(SUBSCRIBER_HOTEL))).rejects.toThrow("Dit account is uitgeschakeld.");
  expect(jar.set).not.toHaveBeenCalled();
});

it("keeps a subscriber to the hotels of its own account", async () => {
  signedIn("operator");
  const filters = database({ hotel: null });

  await expect(selectHotel(form(SUBSCRIBER_HOTEL))).rejects.toThrow("Hotel niet gevonden in dit account.");
  expect(filters).toContainEqual(["hotels.account_id", "own-account"]);
  expect(jar.set).not.toHaveBeenCalled();
});

it("returns the administrator to its own hotels", async () => {
  signedIn("platform_admin");

  await stopViewingOtherAccount();

  expect(jar.delete).toHaveBeenCalledWith("demandradar_selected_hotel");
  expect(redirect).toHaveBeenCalledWith("/calendar");
});
