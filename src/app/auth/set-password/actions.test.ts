import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ redirect: vi.fn((url: string) => { throw new Error(url); }) }));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: vi.fn() }));
import { createServerClient } from "@/lib/supabase/server";
import { setPassword } from "./actions";

const auth = {
  verifyOtp: vi.fn(), getUser: vi.fn(), updateUser: vi.fn(),
};
function form(overrides: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ password: "test-password", confirmation: "test-password", token_hash: "secret", type: "invite", ...overrides })) data.set(key, value);
  return data;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createServerClient).mockResolvedValue({ auth } as unknown as Awaited<ReturnType<typeof createServerClient>>);
  auth.verifyOtp.mockResolvedValue({ error: null });
  auth.getUser.mockResolvedValue({ data: { user: { id: "invited-user" } } });
  auth.updateUser.mockResolvedValue({ error: null });
});

describe("setPassword", () => {
  it.each(["invite", "recovery"])("verifies the %s token only when saving a valid password", async (type) => {
    await expect(setPassword(form({ type }))).rejects.toThrow("/calendar");
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "secret", type });
    expect(auth.updateUser).toHaveBeenCalledWith({ password: "test-password" });
    expect(auth.verifyOtp.mock.invocationCallOrder[0]).toBeLessThan(auth.updateUser.mock.invocationCallOrder[0]);
  });

  it.each([{ password: "short", confirmation: "short" }, { password: "test-password", confirmation: "different" }])("keeps the link usable after invalid password input", async (input) => {
    await expect(setPassword(form(input))).rejects.toThrow("token_hash=secret&type=invite&error=");
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("does not change another logged-in user's password when the email token is invalid", async () => {
    auth.verifyOtp.mockResolvedValue({ error: { code: "otp_expired" } });
    await expect(setPassword(form())).rejects.toThrow("/login?error=invite");
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("allows saving again with the established session after an update error", async () => {
    auth.updateUser.mockResolvedValueOnce({ error: { code: "weak_password" } });
    await expect(setPassword(form())).rejects.toThrow("/auth/set-password?error=save");
    auth.verifyOtp.mockClear();
    await expect(setPassword(form({ token_hash: "", type: "" }))).rejects.toThrow("/calendar");
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("rejects unsupported token types and unauthenticated submissions", async () => {
    await expect(setPassword(form({ type: "signup" }))).rejects.toThrow("/login?error=invite");
    auth.getUser.mockResolvedValue({ data: { user: null } });
    await expect(setPassword(form({ token_hash: "", type: "" }))).rejects.toThrow("/login?error=invite");
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
});
