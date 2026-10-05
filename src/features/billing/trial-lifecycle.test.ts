import { describe, expect, it, vi } from "vitest";

import { runTrialLifecycle, type TrialAccount, type TrialLifecycleDependencies } from "./trial-lifecycle";

const now = new Date("2026-10-02T05:30:00Z");
const daysFromNow = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString();

function setup(accounts: TrialAccount[], overrides: Partial<TrialLifecycleDependencies> = {}) {
  const dependencies = {
    now,
    listTrialAccounts: vi.fn(async () => accounts),
    deactivate: vi.fn(async () => true),
    listMemberEmails: vi.fn(async () => ["owner@hotel.nl", "frontdesk@hotel.nl"]),
    sendReminder: vi.fn(async () => {}),
    markReminded: vi.fn(async () => {}),
    ...overrides,
  } satisfies TrialLifecycleDependencies;
  return dependencies;
}

describe("trial lifecycle", () => {
  it("switches off a trial that ended and sends it no reminder", async () => {
    const dependencies = setup([{ id: "ended", name: "Hotel Oud", trialEndsAt: daysFromNow(-1), reminderSentAt: null }]);
    expect(await runTrialLifecycle(dependencies)).toEqual({ expired: 1, reminded: 0, failed: 0 });
    expect(dependencies.deactivate).toHaveBeenCalledWith("ended", now);
    expect(dependencies.sendReminder).not.toHaveBeenCalled();
  });

  it("reminds every login once in the last week, then remembers it did", async () => {
    const dependencies = setup([{ id: "ending", name: "Hotel Zuid", trialEndsAt: daysFromNow(3), reminderSentAt: null }]);
    expect(await runTrialLifecycle(dependencies)).toEqual({ expired: 0, reminded: 1, failed: 0 });
    expect(vi.mocked(dependencies.sendReminder).mock.calls.map(([input]) => input.email)).toEqual(["owner@hotel.nl", "frontdesk@hotel.nl"]);
    expect(dependencies.sendReminder).toHaveBeenCalledWith(expect.objectContaining({ accountId: "ending", accountName: "Hotel Zuid", endsAt: daysFromNow(3) }));
    expect(dependencies.markReminded).toHaveBeenCalledWith("ending");
  });

  it("leaves a trial alone before its last week and after its reminder", async () => {
    const dependencies = setup([
      { id: "early", name: "Hotel Vroeg", trialEndsAt: daysFromNow(8), reminderSentAt: null },
      { id: "reminded", name: "Hotel Klaar", trialEndsAt: daysFromNow(3), reminderSentAt: daysFromNow(-4) },
    ]);
    expect(await runTrialLifecycle(dependencies)).toEqual({ expired: 0, reminded: 0, failed: 0 });
    expect(dependencies.sendReminder).not.toHaveBeenCalled();
    expect(dependencies.deactivate).not.toHaveBeenCalled();
  });

  it("retries tomorrow when sending fails, and still handles the other accounts", async () => {
    const dependencies = setup([
      { id: "broken", name: "Hotel Fout", trialEndsAt: daysFromNow(3), reminderSentAt: null },
      { id: "ended", name: "Hotel Oud", trialEndsAt: daysFromNow(-1), reminderSentAt: null },
      { id: "fine", name: "Hotel Goed", trialEndsAt: daysFromNow(2), reminderSentAt: null },
    ], {
      sendReminder: vi.fn(async ({ accountId }: { accountId: string }) => {
        if (accountId === "broken") throw new Error("Resend 503");
      }),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await runTrialLifecycle(dependencies)).toEqual({ expired: 1, reminded: 1, failed: 1 });
    expect(dependencies.markReminded).not.toHaveBeenCalledWith("broken");
    expect(dependencies.markReminded).toHaveBeenCalledWith("fine");
    expect(dependencies.deactivate).toHaveBeenCalledWith("ended", now);
  });

  it("stops trying to remind an account that has no login left", async () => {
    const dependencies = setup([{ id: "orphan", name: "Hotel Leeg", trialEndsAt: daysFromNow(3), reminderSentAt: null }], {
      listMemberEmails: vi.fn(async () => []),
    });
    expect(await runTrialLifecycle(dependencies)).toEqual({ expired: 0, reminded: 0, failed: 0 });
    expect(dependencies.markReminded).toHaveBeenCalledWith("orphan");
  });
});
