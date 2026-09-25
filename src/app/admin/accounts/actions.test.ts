import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ redirect: vi.fn((url: string) => { throw new Error(url); }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const selection = vi.hoisted(() => ({ get: vi.fn(), delete: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => selection }));
vi.mock("@/lib/auth/require-account", () => ({ requirePlatformAdmin: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/features/notifications/service", () => ({ baselineMemberNotifications: vi.fn().mockResolvedValue(0) }));
vi.mock("server-only", () => ({}));
import { requirePlatformAdmin } from "@/lib/auth/require-account";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSubscriberAccount, deleteSubscriberUser, resendSubscriberLink, setSubscriberHotelArchived } from "./actions";
import { revalidatePath } from "next/cache";

const auth = {
  admin: { createUser: vi.fn(), inviteUserByEmail: vi.fn(), deleteUser: vi.fn(), getUserById: vi.fn() },
  resetPasswordForEmail: vi.fn(),
};
const from = vi.fn();
function query(data: unknown, error: unknown = null) {
  const result = { data, error };
  const builder = {
    select: vi.fn(), eq: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    single: vi.fn().mockResolvedValue(result), maybeSingle: vi.fn().mockResolvedValue(result),
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  };
  for (const method of [builder.select, builder.eq, builder.insert, builder.update, builder.delete]) method.mockReturnValue(builder);
  return builder;
}
function form(values: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ accountId: "account-1", userId: "subscriber-1", ...values })) data.set(key, value);
  return data;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.example");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(requirePlatformAdmin).mockResolvedValue({ userId: "admin-1", accountId: "admin-account", accountName: "Admin", role: "platform_admin" });
  vi.mocked(createAdminClient).mockReturnValue({ auth, from } as unknown as ReturnType<typeof createAdminClient>);
  auth.admin.deleteUser.mockResolvedValue({ error: null });
  auth.resetPasswordForEmail.mockResolvedValue({ error: null });
});

describe("subscriber actions", () => {
  it("deletes only the selected operator login, never the account or hotels", async () => {
    const membership = query({ user_id: "subscriber-1", role: "operator" });
    from.mockReturnValue(membership);
    await expect(deleteSubscriberUser(form())).rejects.toThrow("notice=deleted");
    expect(membership.eq.mock.calls).toEqual([["account_id", "account-1"], ["user_id", "subscriber-1"]]);
    expect(auth.admin.deleteUser).toHaveBeenCalledWith("subscriber-1");
    expect(from.mock.calls).toEqual([["account_members"]]);
    expect(membership.delete).not.toHaveBeenCalled();
  });

  it.each([
    { user_id: "subscriber-1", role: "platform_admin" },
    { user_id: "admin-1", role: "operator" },
    null,
  ])("rejects self, administrator and unlinked deletion: %j", async (member) => {
    from.mockReturnValue(query(member));
    await expect(deleteSubscriberUser(form())).rejects.toThrow(member ? "notice=protected" : "notice=missing");
    expect(auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it("requires administrator authorization before using the privileged client", async () => {
    vi.mocked(requirePlatformAdmin).mockRejectedValue(new Error("/calendar"));
    await expect(deleteSubscriberUser(form())).rejects.toThrow("/calendar");
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("sends recovery to the saved email without creating or deleting users", async () => {
    from.mockReturnValueOnce(query({ user_id: "subscriber-1", role: "operator" })).mockReturnValueOnce(query({ id: "account-1", active: true }));
    auth.admin.getUserById.mockResolvedValue({ data: { user: { email: "saved@example.com" } }, error: null });
    await expect(resendSubscriberLink(form({ email: "forged@example.com" }))).rejects.toThrow("notice=resent");
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("saved@example.com", { redirectTo: "https://app.example/auth/confirm?next=/auth/set-password" });
    expect(auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
    expect(auth.admin.createUser).not.toHaveBeenCalled();
    expect(auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it("does not send recovery for an inactive account", async () => {
    from.mockReturnValueOnce(query({ user_id: "subscriber-1", role: "operator" })).mockReturnValueOnce(query({ id: "account-1", active: false }));
    await expect(resendSubscriberLink(form())).rejects.toThrow("notice=inactive");
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("shows an email-rate message instead of throwing the provider error", async () => {
    from.mockReturnValueOnce(query({ user_id: "subscriber-1", role: "operator" })).mockReturnValueOnce(query({ id: "account-1", active: true }));
    auth.admin.getUserById.mockResolvedValue({ data: { user: { email: "saved@example.com" } }, error: null });
    auth.resetPasswordForEmail.mockResolvedValue({ error: { code: "over_email_send_rate_limit" } });
    await expect(resendSubscriberLink(form())).rejects.toThrow("notice=rate");
  });

  it("does not re-invite or delete an existing identity during duplicate provisioning", async () => {
    auth.admin.createUser.mockResolvedValue({ data: { user: null }, error: { code: "email_exists" } });
    await expect(createSubscriberAccount(form({ accountId: "", accountName: "Test hotel", email: "existing@example.com" }))).rejects.toThrow("notice=existing");
    expect(auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
    expect(auth.admin.deleteUser).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("attaches a replacement login to the retained account without inserting another account", async () => {
    const membership = query(null);
    from.mockReturnValueOnce(query({ id: "account-1", active: true })).mockReturnValue(membership);
    auth.admin.createUser.mockResolvedValue({ data: { user: { id: "replacement" } }, error: null });
    auth.admin.inviteUserByEmail.mockResolvedValue({ data: { user: { id: "replacement" } }, error: null });
    await expect(createSubscriberAccount(form({ email: "new@example.com" }))).rejects.toThrow("notice=invited");
    expect(membership.insert).toHaveBeenCalledWith({ account_id: "account-1", user_id: "replacement", event_notifications_enabled: false });
    expect(membership.update).toHaveBeenCalledWith({ event_notifications_enabled: true });
  });

  it("reports deletion failure without deleting any portfolio records", async () => {
    from.mockReturnValue(query({ user_id: "subscriber-1", role: "operator" }));
    auth.admin.deleteUser.mockResolvedValue({ error: { code: "unexpected_failure" } });
    await expect(deleteSubscriberUser(form())).rejects.toThrow("notice=failed");
    expect(from.mock.calls).toEqual([["account_members"]]);
  });
});

describe("administrator hotel archiving", () => {
  it.each(["true", "false"])("sets archived=%s for the selected account's hotel without requiring a login or starting searches", async archived => {
    const hotel = query({ id: "hotel-1" });
    from.mockReturnValue(hotel);
    selection.get.mockReturnValue({ value: "hotel-1" });
    await expect(setSubscriberHotelArchived(form({ hotelId: "hotel-1", archived })))
      .rejects.toThrow(archived === "true" ? "notice=hotel-archived" : "notice=hotel-restored");
    expect(from.mock.calls).toEqual([["hotels"]]);
    expect(hotel.eq.mock.calls).toEqual([["account_id", "account-1"], ["id", "hotel-1"]]);
    expect(hotel.update).toHaveBeenCalledWith({ archived_at: archived === "true" ? expect.any(String) : null });
    expect(hotel.delete).not.toHaveBeenCalled();
    expect(selection.delete).toHaveBeenCalledTimes(archived === "true" ? 1 : 0);
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("rejects non-administrators before accessing another account's hotel", async () => {
    vi.mocked(requirePlatformAdmin).mockRejectedValue(new Error("/calendar"));
    await expect(setSubscriberHotelArchived(form({ hotelId: "hotel-1", archived: "true" }))).rejects.toThrow("/calendar");
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects a missing or mismatched hotel without reporting success", async () => {
    from.mockReturnValue(query(null));
    await expect(setSubscriberHotelArchived(form({ hotelId: "hotel-1", archived: "true" }))).rejects.toThrow("notice=hotel-missing");
    expect(selection.delete).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalledWith("/", "layout");
  });

  it.each([{ hotelId: "", archived: "true" }, { hotelId: "hotel-1", archived: "" }])("rejects incomplete input: %j", async values => {
    await expect(setSubscriberHotelArchived(form(values))).rejects.toThrow("notice=hotel-input");
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
