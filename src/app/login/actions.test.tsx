import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const auth = vi.hoisted(() => ({ signInWithPassword: vi.fn(async () => ({ error: null as unknown })), getClaims: vi.fn(async () => ({ data: { claims: null } })) }));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ auth }) }));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
import { login } from "./actions";
import { proxy } from "../../proxy";
import LoginPage from "./page";
import { render, screen, cleanup } from "@testing-library/react";
const destination = "/open-calendar/11111111-1111-4111-8111-111111111111";
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("preserves the emailed hotel through proxy, form and login", async () => {
  const response = await proxy(new NextRequest(`https://example.com${destination}`));
  const url = new URL(response.headers.get("location")!);
  expect(url.pathname).toBe("/login");
  expect(url.searchParams.get("next")).toBe(destination);
  render(await LoginPage({ searchParams: Promise.resolve({ next: url.searchParams.get("next")! }) }));
  const form = screen.getByRole("button", { name: "Inloggen" }).closest("form")!;
  const data = new FormData(form);
  data.set("email", "hotel@example.com"); data.set("password", "password");
  await expect(login(data)).rejects.toThrow(destination);
  auth.signInWithPassword.mockResolvedValueOnce({ error: new Error("bad password") });
  await expect(login(data)).rejects.toThrow(`/login?error=credentials&next=${encodeURIComponent(destination)}`);
});
it.each(["https://evil.example", "//evil.example", "/open-calendar/../evil", "/open-calendar/x", "/calendar"])("rejects unsafe or unrelated destinations: %s", async (next) => {
  const data = new FormData(); data.set("email", "hotel@example.com"); data.set("password", "password"); data.set("next", next);
  await expect(login(data)).rejects.toThrow(/^\/calendar$/);
});
