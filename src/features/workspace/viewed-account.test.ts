import { beforeEach, expect, it, vi } from "vitest";

const cookieJar = { selectedHotelId: undefined as string | undefined };

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (cookieJar.selectedHotelId ? { value: cookieJar.selectedHotelId } : undefined),
  }),
}));
vi.mock("@/lib/auth/require-account", () => ({ requireAccount: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: vi.fn() }));

import { requireAccount } from "@/lib/auth/require-account";
import { createServerClient, type ServerClient } from "@/lib/supabase/server";

import { requireViewedAccount } from "./viewed-account";

const OTHER_HOTEL = "6f1d2c4e-1111-4222-8333-444455556666";

function signedIn(role: "operator" | "platform_admin") {
  vi.mocked(requireAccount).mockResolvedValue({
    accountId: "own-account",
    accountName: "Hotelrevpar",
    role,
    userId: "user-1",
  });
}

function database(rows: { hotel?: { account_id: string } | null; account?: { name: string } | null }) {
  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is"]) builder[method] = vi.fn(() => builder);
    builder.maybeSingle = vi.fn(async () => ({
      data: table === "hotels" ? rows.hotel ?? null : rows.account ?? null,
      error: null,
    }));
    return builder;
  });
  vi.mocked(createServerClient).mockResolvedValue({ from } as unknown as ServerClient);
  return from;
}

beforeEach(() => {
  vi.clearAllMocks();
  cookieJar.selectedHotelId = OTHER_HOTEL;
});

it("keeps a subscriber on its own account even when the cookie names another hotel", async () => {
  signedIn("operator");
  const from = database({ hotel: { account_id: "subscriber-account" } });

  expect(await requireViewedAccount()).toMatchObject({
    accountId: "own-account",
    viewedAccountId: "own-account",
    viewedAccountName: "Hotelrevpar",
    viewingOtherAccount: false,
  });
  expect(from).not.toHaveBeenCalled();
});

it("puts the administrator on the subscriber account owning the selected hotel", async () => {
  signedIn("platform_admin");
  database({ hotel: { account_id: "subscriber-account" }, account: { name: "Sandton Eindhoven" } });

  expect(await requireViewedAccount()).toMatchObject({
    accountId: "own-account",
    viewedAccountId: "subscriber-account",
    viewedAccountName: "Sandton Eindhoven",
    viewingOtherAccount: true,
  });
});

it("stays on the administrator's own account for its own hotel", async () => {
  signedIn("platform_admin");
  database({ hotel: { account_id: "own-account" } });

  expect(await requireViewedAccount()).toMatchObject({
    viewedAccountId: "own-account",
    viewingOtherAccount: false,
  });
});

it("ignores a hotel of a switched-off account", async () => {
  signedIn("platform_admin");
  database({ hotel: { account_id: "subscriber-account" }, account: null });

  expect(await requireViewedAccount()).toMatchObject({
    viewedAccountId: "own-account",
    viewingOtherAccount: false,
  });
});

it("does not query the database for a malformed hotel cookie", async () => {
  signedIn("platform_admin");
  cookieJar.selectedHotelId = "not-a-hotel-id";
  const from = database({});

  expect(await requireViewedAccount()).toMatchObject({ viewingOtherAccount: false });
  expect(from).not.toHaveBeenCalled();
});
