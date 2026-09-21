import { render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-account", () => ({ requirePlatformAdmin: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("./actions", () => ({ createSubscriberAccount: vi.fn(), deleteSubscriberUser: vi.fn(), resendSubscriberLink: vi.fn(), setSubscriberHotelArchived: vi.fn() }));
import { requirePlatformAdmin } from "@/lib/auth/require-account";
import { createAdminClient } from "@/lib/supabase/admin";
import AccountsPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlatformAdmin).mockResolvedValue({ accountId: "admin", accountName: "Admin", role: "platform_admin", userId: "admin-user" });
  const rows: Record<string, unknown[]> = {
    accounts: [{ id: "retained", name: "Account zonder login", active: true }, { id: "subscriber", name: "Abonnee", active: true }],
    account_members: [{ account_id: "subscriber", user_id: "user", role: "operator" }],
    hotels: [
      { id: "old-hotel", account_id: "retained", name: "Bewaard hotel", archived_at: null },
      { id: "archived-hotel", account_id: "subscriber", name: "Gearchiveerd hotel", archived_at: "2026-09-20T12:00:00Z" },
    ],
  };
  const admin = {
    from: (table: string) => {
      const result = { data: rows[table], error: null };
      const query = { select: () => query, order: () => query, range: () => query, then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve) };
      return query;
    },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: "subscriber@example.com" } }, error: null }) } },
  };
  vi.mocked(createAdminClient).mockReturnValue(admin as unknown as ReturnType<typeof createAdminClient>);
});

it("keeps hotels manageable after the last login was removed and offers restore for archived hotels", async () => {
  render(await AccountsPage({ searchParams: Promise.resolve({}) }));
  const retained = screen.getByText("Account zonder login").closest("tr")!;
  expect(within(retained).getByText("Geen login")).toBeInTheDocument();
  expect(within(retained).getByText("Bewaard hotel")).toBeInTheDocument();
  const archive = within(retained).getByRole("button", { name: "Archiveren", hidden: true }).closest("form")!;
  expect(new FormData(archive).get("accountId")).toBe("retained");
  expect(new FormData(archive).get("hotelId")).toBe("old-hotel");
  expect(new FormData(archive).get("archived")).toBe("true");
  const restore = screen.getByRole("button", { name: "Herstellen", hidden: true }).closest("form")!;
  expect(new FormData(restore).get("hotelId")).toBe("archived-hotel");
  expect(new FormData(restore).get("archived")).toBe("false");
});

it("requires platform administration before loading the account list", async () => {
  vi.mocked(requirePlatformAdmin).mockRejectedValue(new Error("/calendar"));
  await expect(AccountsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("/calendar");
  expect(createAdminClient).not.toHaveBeenCalled();
});
