import { beforeEach, expect, it, vi } from "vitest";
const { identity, query, hotelScope } = vi.hoisted(() => ({
  identity: { accountId: "owned-account", role: "operator" },
  query: vi.fn(),
  hotelScope: vi.fn(),
}));
vi.mock("@/lib/auth/require-account", () => ({
  requireAccount: async () => identity,
}));
vi.mock("@/features/workspace/hotel-context", () => ({
  getHotelScope: hotelScope,
}));
vi.mock("@/features/collection/status", () => ({ getCollectionStatus: query }));
import { GET } from "./route";
beforeEach(() => {
  identity.role = "operator";
  query
    .mockReset()
    .mockResolvedValue({
      pending: false,
      revision: "r",
      watchKey: "w",
      batch: null,
    });
  hotelScope.mockReset().mockResolvedValue({ areaId: "owned-area" });
});
it("derives scope from authentication and the validated selected hotel", async () => {
  const response = await GET(
    new Request(
      "https://example.com/api/collection-status?accountId=foreign&areaId=foreign",
    ),
  );
  expect(hotelScope).toHaveBeenCalledWith("owned-account");
  expect(query).toHaveBeenCalledWith("owned-account", "owned-area", false);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(JSON.stringify(await response.json()).length).toBeLessThan(5000);
});
it("denies operator access to platform-wide status before querying data", async () => {
  expect(
    (
      await GET(
        new Request("https://example.com/api/collection-status?scope=platform"),
      )
    ).status,
  ).toBe(403);
  expect(query).not.toHaveBeenCalled();
});
it("allows platform scope only for platform administrators", async () => {
  identity.role = "platform_admin";
  await GET(
    new Request("https://example.com/api/collection-status?scope=platform"),
  );
  expect(query).toHaveBeenCalledWith("owned-account", "owned-area", true);
});
