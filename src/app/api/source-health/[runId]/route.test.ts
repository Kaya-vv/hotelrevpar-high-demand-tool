import { beforeEach, expect, it, vi } from "vitest";
const { identity, query } = vi.hoisted(() => ({
  identity: { role: "operator" },
  query: vi.fn(),
}));
vi.mock("@/lib/auth/require-account", () => ({
  requireAccount: async () => identity,
}));
vi.mock("@/features/accounts/source-health", () => ({
  getSourceHealthRuns: query,
}));
import { GET } from "./route";
const id = "ab53dce1-1213-4d9a-bbcb-8dd228b07b2f";
beforeEach(() => {
  identity.role = "operator";
  query.mockReset().mockResolvedValue([{ id }]);
});
it("denies detail reads before querying for an operator", async () => {
  expect(
    (
      await GET(new Request("https://example.com"), {
        params: Promise.resolve({ runId: id }),
      })
    ).status,
  ).toBe(403);
  expect(query).not.toHaveBeenCalled();
});
it("returns only the explicitly requested run for an administrator", async () => {
  identity.role = "platform_admin";
  const response = await GET(new Request("https://example.com"), {
    params: Promise.resolve({ runId: id }),
  });
  expect(query).toHaveBeenCalledWith(0, id);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ id });
});
