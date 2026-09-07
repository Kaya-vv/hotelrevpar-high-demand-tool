import { expect, it, vi } from "vitest";
import { refreshHotel } from "./actions";
import { enqueueCollectionAreas, publishCollectionJob } from "./jobs";

const { query } = vi.hoisted(() => ({ query: { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn() } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/require-account", () => ({ requirePlatformAdmin: vi.fn(async () => ({ accountId: "account", userId: "admin" })) }));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: vi.fn(async () => ({ from: () => query })) }));
vi.mock("./jobs", () => ({ enqueueCollectionAreas: vi.fn(), publishCollectionJob: vi.fn(async () => {}) }));

it("retries only publication for a hotel scoped to the admin account", async () => {
  for (const key of ["select", "eq", "order", "limit"] as const) query[key].mockReturnValue(query);
  query.maybeSingle.mockResolvedValueOnce({ data: { id: "area" } }).mockResolvedValueOnce({ data: { id: "run" } });
  const form = new FormData();
  form.set("hotelId", "hotel"); form.set("operation", "publication");
  expect(await refreshHotel({}, form)).toMatchObject({ message: expect.stringContaining("geen nieuw onderzoek") });
  expect(publishCollectionJob).toHaveBeenCalledWith(expect.objectContaining({ kind: "market-publication", accountId: "account", areaId: "area", runId: "run" }));
  expect(enqueueCollectionAreas).not.toHaveBeenCalled();
  expect(query.eq).toHaveBeenCalledWith("account_id", "account");
  expect(query.eq).toHaveBeenCalledWith("hotel_id", "hotel");
  vi.mocked(publishCollectionJob).mockClear();
  query.maybeSingle.mockResolvedValueOnce({ data: null });
  expect(await refreshHotel({}, form)).toMatchObject({ error: true });
  expect(publishCollectionJob).not.toHaveBeenCalled();
});
