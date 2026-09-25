import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ limit: null as number | null, count: 0, insert: vi.fn(), geocode: vi.fn() }));
vi.mock("@/lib/auth/require-account", () => ({ requireAccount: async () => ({ accountId: "owned", userId: "user", role: "operator" }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: vi.fn() }) }));
vi.mock("@/features/collection/jobs", () => ({ enqueueCollectionAreas: vi.fn() }));
vi.mock("./geocode", () => ({ getAddressById: mocks.geocode }));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ from: (table: string) => {
  const result = table === "accounts"
    ? { data: { hotel_limit: mocks.limit }, error: null }
    : { data: null, count: mocks.count, error: null };
  const query = {
    select: () => query, eq: () => query, is: () => query, insert: mocks.insert,
    single: async () => result,
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  };
  return query;
} }) }));
import { saveHotel } from "./actions";

function newHotel() {
  const form = new FormData();
  form.set("name", "Hotel Zuid");
  form.set("addressId", "adr-1");
  form.set("revcontrolCode", "ZUID");
  form.set("address", "Stationsplein 1, Eindhoven");
  form.set("demandRadiusKm", "25");
  return form;
}
beforeEach(() => { vi.clearAllMocks(); mocks.geocode.mockRejectedValue(new Error("Adres niet gevonden.")); });

it("refuses a new hotel when the account is full, before any paid address lookup", async () => {
  mocks.limit = 2;
  mocks.count = 2;
  const state = await saveHotel({}, newHotel());
  expect(state.message).toBe("Je account heeft ruimte voor 2 hotels. Archiveer een hotel of neem contact op om er meer toe te voegen.");
  expect(mocks.geocode).not.toHaveBeenCalled();
  expect(mocks.insert).not.toHaveBeenCalled();
});

it("lets an account without a limit continue to the address check", async () => {
  mocks.limit = null;
  mocks.count = 40;
  await saveHotel({}, newHotel());
  expect(mocks.geocode).toHaveBeenCalled();
});
