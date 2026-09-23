import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-account", () => ({ requireAccount: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));
import { requireAccount } from "@/lib/auth/require-account";
import { createServerClient } from "@/lib/supabase/server";
import { overrideImportance } from "./actions";

function query(data: unknown) {
  const result = { data, error: null };
  const builder = { select: vi.fn(), eq: vi.fn(), update: vi.fn(), maybeSingle: async () => result,
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve) };
  for (const method of [builder.select, builder.eq, builder.update]) method.mockReturnValue(builder);
  return builder;
}
const from = vi.fn();
function form() {
  const data = new FormData();
  data.set("hotelId", "own-hotel"); data.set("eventId", "glow"); data.set("importance", "High");
  return data;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(requireAccount).mockResolvedValue({ accountId: "own-account", accountName: "Test Hotel", role: "operator", userId: "subscriber" });
  vi.mocked(createServerClient).mockResolvedValue({ from } as unknown as Awaited<ReturnType<typeof createServerClient>>);
});

it("saves a subscriber's manual level only for the owned hotel and selected event", async () => {
  const event = query({ event_id: "glow" }), hotel = query({ id: "own-hotel" }), score = query([{ hotel_id: "own-hotel" }]);
  from.mockReturnValueOnce(event).mockReturnValueOnce(hotel).mockReturnValueOnce(score);
  expect(await overrideImportance(null, form())).toMatchObject({ ok: true });
  expect(event.eq).toHaveBeenCalledWith("account_id", "own-account");
  expect(hotel.eq).toHaveBeenCalledWith("account_id", "own-account");
  expect(hotel.eq).toHaveBeenCalledWith("id", "own-hotel");
  expect(score.update).toHaveBeenCalledWith({ importance_override: "High", override_note: null });
  expect(score.eq.mock.calls).toEqual([["hotel_id", "own-hotel"], ["event_id", "glow"]]);
});

it("rejects a hotel outside the subscriber's account before updating a score", async () => {
  from.mockReturnValueOnce(query({ event_id: "glow" })).mockReturnValueOnce(query(null));
  expect(await overrideImportance(null, form())).toMatchObject({ ok: false, message: "Dit hotel hoort niet bij dit account." });
  expect(from.mock.calls).toEqual([["account_events"], ["hotels"]]);
});

it("rejects an event outside the subscriber's account before accessing hotel scores", async () => {
  from.mockReturnValueOnce(query(null));
  expect(await overrideImportance(null, form())).toMatchObject({ ok: false });
  expect(from.mock.calls).toEqual([["account_events"]]);
});
