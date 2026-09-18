import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-account", () => ({ requireAccount: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: vi.fn() }));

import { requireAccount } from "@/lib/auth/require-account";
import { createServerClient, type ServerClient } from "@/lib/supabase/server";
import { GET } from "./route";

function hotelQuery(data: unknown) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.is.mockReturnValue(query);
  return query;
}

describe("notification calendar link", () => {
  beforeEach(() => {
    vi.mocked(requireAccount).mockResolvedValue({
      accountId: "account-1",
      accountName: "Hotel account",
      role: "operator",
      userId: "user-1",
    });
  });

  it("selects an owned hotel and redirects to its calendar", async () => {
    vi.mocked(createServerClient).mockResolvedValue({
      from: vi.fn(() => hotelQuery({ id: "hotel-1" })),
    } as unknown as ServerClient);
    const response = await GET(
      new Request("https://app.example/open-calendar/hotel-1") as never,
      { params: Promise.resolve({ hotelId: "hotel-1" }) },
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://app.example/calendar");
    expect(response.headers.get("set-cookie")).toContain("demandradar_selected_hotel=hotel-1");
  });

  it("does not select a hotel from another account", async () => {
    vi.mocked(createServerClient).mockResolvedValue({
      from: vi.fn(() => hotelQuery(null)),
    } as unknown as ServerClient);
    const response = await GET(
      new Request("https://app.example/open-calendar/hotel-2") as never,
      { params: Promise.resolve({ hotelId: "hotel-2" }) },
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("lets the platform administrator open a subscriber hotel", async () => {
    vi.mocked(requireAccount).mockResolvedValue({
      accountId: "account-1",
      accountName: "Hotelrevpar",
      role: "platform_admin",
      userId: "user-1",
    });
    const query = hotelQuery({ id: "hotel-2" });
    vi.mocked(createServerClient).mockResolvedValue({
      from: vi.fn(() => query),
    } as unknown as ServerClient);
    const response = await GET(
      new Request("https://app.example/open-calendar/hotel-2") as never,
      { params: Promise.resolve({ hotelId: "hotel-2" }) },
    );

    expect(response.headers.get("set-cookie")).toContain("demandradar_selected_hotel=hotel-2");
    expect(query.eq.mock.calls).toEqual([["id", "hotel-2"]]);
  });
});
