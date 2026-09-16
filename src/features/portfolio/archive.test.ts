import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ update: vi.fn(), eq: vi.fn(), single: vi.fn(), remove: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/auth/require-account", () => ({ requireAccount: async () => ({ accountId: "owned" }) }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "hotel" }), delete: mocks.remove }) }));
vi.mock("@/features/collection/jobs", () => ({ enqueueCollectionAreas: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ from: () => query }) }));
const query = { update: mocks.update, eq: mocks.eq, select: () => query, single: mocks.single };
import { setHotelArchived } from "./actions";
beforeEach(() => { vi.clearAllMocks(); mocks.update.mockReturnValue(query); mocks.eq.mockReturnValue(query); mocks.single.mockResolvedValue({ data: { id: "hotel" }, error: null }); });
function form(archived: boolean) { const value = new FormData(); value.set("hotelId", "hotel"); value.set("archived", String(archived)); return value; }
it("archives only an owned hotel and clears its selection", async () => {
  await setHotelArchived(form(true));
  expect(mocks.eq).toHaveBeenCalledWith("account_id", "owned");
  expect(mocks.eq).toHaveBeenCalledWith("id", "hotel");
  expect(mocks.update).toHaveBeenCalledWith({ archived_at: expect.any(String) });
  expect(mocks.remove).toHaveBeenCalled();
  expect(mocks.revalidate).toHaveBeenCalledWith("/", "layout");
});
it("restores without starting a search or deleting history", async () => {
  await setHotelArchived(form(false));
  expect(mocks.update).toHaveBeenCalledWith({ archived_at: null });
  expect(mocks.remove).not.toHaveBeenCalled();
});
it("does not report success for another account's hotel", async () => {
  mocks.single.mockResolvedValue({ data: null, error: new Error("not found") });
  await expect(setHotelArchived(form(true))).rejects.toThrow("not found");
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
