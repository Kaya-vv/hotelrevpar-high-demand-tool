import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
const reset = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ auth: { resetPasswordForEmail: reset } }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
import { requestPasswordReset } from "./actions";
import LoginPage from "./page";
afterEach(() => { cleanup(); reset.mockReset(); vi.unstubAllEnvs(); });
function form(email: string) { const data = new FormData(); data.set("email", email); return data; }
it("offers reset without requiring a password and confirms without exposing account existence", async () => {
  render(await LoginPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByRole("link", { name: "Wachtwoord vergeten?" })).toHaveAttribute("href", "/login?reset=true");
  cleanup();
  render(await LoginPage({ searchParams: Promise.resolve({ reset: "true" }) }));
  expect(screen.getByLabelText("E-mailadres")).toBeRequired();
  expect(document.querySelector('input[type="password"]')).toBeNull();
  expect(screen.getByRole("button", { name: "Verstuur wachtwoordlink" })).toBeInTheDocument();
  cleanup();
  render(await LoginPage({ searchParams: Promise.resolve({ reset: "true", sent: "true" }) }));
  expect(screen.getByRole("status")).toHaveTextContent("Als dit e-mailadres bij ons bekend is");
});
it.each(["https://example.com", "example.com"])("uses the existing recovery flow with site setting %s", async (site) => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", site);
  reset.mockResolvedValue({ error: null });
  for (const email of ["known@example.com", "unknown@example.com"]) {
    await expect(requestPasswordReset(form(` ${email} `))).rejects.toThrow("/login?reset=true&sent=true");
    expect(reset).toHaveBeenLastCalledWith(email, { redirectTo: "https://example.com/auth/confirm?next=/auth/set-password" });
  }
});
it("rejects invalid input without sending", async () => {
  await expect(requestPasswordReset(form("invalid"))).rejects.toThrow("/login?reset=true&error=email");
  expect(reset).not.toHaveBeenCalled();
});
it("handles rate limits and connection failures without exposing provider details", async () => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://example.com");
  reset.mockResolvedValueOnce({ error: { status: 429, message: "private" } }).mockRejectedValueOnce(new Error("private"));
  for (let i = 0; i < 2; i++) await expect(requestPasswordReset(form("hotel@example.com"))).rejects.toThrow("/login?reset=true&error=reset");
});
