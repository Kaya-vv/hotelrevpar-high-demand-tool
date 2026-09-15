import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth/require-account", () => ({ requireAccount: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/features/notifications/service", () => ({
  baselineMemberNotifications: vi.fn(),
  disableMemberNotifications: vi.fn(),
}));

import {
  baselineMemberNotifications,
  disableMemberNotifications,
} from "@/features/notifications/service";
import { requireAccount } from "@/lib/auth/require-account";
import { createAdminClient } from "@/lib/supabase/admin";
import { updateEventNotifications } from "./actions";

function form(enabled: boolean) {
  const data = new FormData();
  if (enabled) data.set("enabled", "true");
  return data;
}

function memberQuery(current: boolean) {
  const updates: unknown[] = [];
  const result = { data: { event_notifications_enabled: current }, error: null };
  const query = {
    select: vi.fn(),
    update: vi.fn((value: unknown) => {
      updates.push(value);
      return query;
    }),
    eq: vi.fn(),
    single: vi.fn().mockResolvedValue(result),
    then: (resolve: (value: { error: null }) => unknown) =>
      Promise.resolve({ error: null }).then(resolve),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return { query, updates };
}

describe("personal event notification preference", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireAccount).mockResolvedValue({
      accountId: "account-1",
      accountName: "Hotel account",
      role: "operator",
      userId: "user-1",
    });
  });

  it("baselines the current calendar before turning notifications on", async () => {
    const member = memberQuery(false);
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => member.query),
    } as unknown as ReturnType<typeof createAdminClient>);

    await updateEventNotifications(form(true));

    expect(baselineMemberNotifications).toHaveBeenCalledWith(
      "account-1",
      "user-1",
      expect.anything(),
    );
    expect(member.updates).toContainEqual({ event_notifications_enabled: true });
    expect(disableMemberNotifications).not.toHaveBeenCalled();
  });

  it("turns sending off before cancelling unsent mail", async () => {
    const member = memberQuery(true);
    const admin = { from: vi.fn(() => member.query) } as unknown as ReturnType<
      typeof createAdminClient
    >;
    vi.mocked(createAdminClient).mockReturnValue(admin);

    await updateEventNotifications(form(false));

    expect(member.updates).toContainEqual({ event_notifications_enabled: false });
    expect(disableMemberNotifications).toHaveBeenCalledWith(
      "account-1",
      "user-1",
      admin,
    );
  });
});
