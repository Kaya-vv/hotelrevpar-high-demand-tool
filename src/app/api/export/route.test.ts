import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/auth/require-account", () => ({ requireAccount: vi.fn(async () => ({ accountId: "account", userId: "user" })) }));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/features/export/create", async (original) => ({ ...await original<typeof import("@/features/export/create")>(), createExport: vi.fn() }));
import { POST } from "./route";
import { GET } from "./[batchId]/route";
import { createExport, ExportConflict } from "@/features/export/create";
import { createServerClient } from "@/lib/supabase/server";

beforeEach(() => vi.clearAllMocks());
const request = () => new Request("http://localhost/api/export", { method: "POST", body: JSON.stringify({ requestKey: randomUUID(), hotelIds: [randomUUID()], from: "2027-01-01", to: "2027-12-31", mode: "new" }) });
it("validates requests and reports stale exports as conflicts", async () => {
  expect((await POST(new Request("http://localhost/api/export", { method: "POST", body: "{}" }))).status).toBe(400);
  vi.mocked(createExport).mockRejectedValue(new ExportConflict("Stale"));
  expect((await POST(request())).status).toBe(409);
  vi.mocked(createExport).mockRejectedValue({ code: "42501" });
  expect((await POST(request())).status).toBe(403);
  vi.mocked(createExport).mockResolvedValue("batch");
  expect(await (await POST(request())).json()).toEqual({ id: "batch", url: "/api/export/batch" });
});
it("serves saved bytes only through account-scoped downloads", async () => {
  const eq = vi.fn(); const builder = { select: vi.fn(), eq, maybeSingle: vi.fn() };
  builder.select.mockReturnValue(builder); eq.mockReturnValue(builder);
  builder.maybeSingle.mockResolvedValue({ data: { workbook: "\\x010203" }, error: null });
  vi.mocked(createServerClient).mockResolvedValue({ from: () => builder } as unknown as Awaited<ReturnType<typeof createServerClient>>);
  const batchId = randomUUID();
  const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ batchId }) });
  expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
  expect(eq).toHaveBeenCalledWith("account_id", "account");
  expect(eq).toHaveBeenCalledWith("id", batchId);
  expect(response.headers.get("cache-control")).toContain("no-store");
  builder.maybeSingle.mockResolvedValue({ data: null, error: null });
  expect((await GET(new Request("http://localhost"), { params: Promise.resolve({ batchId }) })).status).toBe(404);
});
