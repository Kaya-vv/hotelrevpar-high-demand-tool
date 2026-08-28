import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAccount, searchAddresses } = vi.hoisted(() => ({
  requireAccount: vi.fn(),
  searchAddresses: vi.fn(),
}));

vi.mock("@/lib/auth/require-account", () => ({ requireAccount }));
vi.mock("@/features/portfolio/geocode", () => ({ searchAddresses }));

import { GET } from "./route";

describe("address search route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAccount.mockResolvedValue({ accountId: "account-1" });
  });

  it("returns suggestions to an authenticated subscriber", async () => {
    searchAddresses.mockResolvedValue([{ id: "address-1", label: "Kleine Berg 43, 5611JS Eindhoven" }]);

    const response = await GET(new Request("http://localhost/api/addresses?q=Kleine%20Berg%2043"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      suggestions: [{ id: "address-1", label: "Kleine Berg 43, 5611JS Eindhoven" }],
    });
    expect(requireAccount).toHaveBeenCalledOnce();
    expect(searchAddresses).toHaveBeenCalledWith("Kleine Berg 43");
  });

  it("does not search before authentication succeeds", async () => {
    requireAccount.mockRejectedValue(new Error("unauthenticated"));

    await expect(GET(new Request("http://localhost/api/addresses?q=Kleine"))).rejects.toThrow("unauthenticated");
    expect(searchAddresses).not.toHaveBeenCalled();
  });
});
