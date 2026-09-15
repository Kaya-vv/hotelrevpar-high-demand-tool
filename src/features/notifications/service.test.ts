import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { notificationRetryExpired, postEventNotification } from "./service";

const input = {
  id: "batch-1",
  recipientEmail: "hotel@example.com",
  subject: "2 nieuwe events",
  html: "<p>Events</p>",
  text: "Events",
};
const config = {
  apiKey: "re_test",
  from: "DemandRadar <events@example.com>",
  replyTo: "info@example.com",
};

describe("Resend event notification request", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends one recipient with a stable batch idempotency key", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "email-1" }), { status: 200 }),
    );
    await expect(postEventNotification(input, config, fetcher)).resolves.toEqual({
      accepted: true,
      providerMessageId: "email-1",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Idempotency-Key": "demandradar/event-notification/batch-1",
        }),
      }),
    );
    const request = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(request.to).toEqual(["hotel@example.com"]);
    expect(request).toMatchObject({ reply_to: "info@example.com" });
  });

  it("reuses the same key when saving an accepted send must be retried", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "email-1" }), { status: 200 }),
    );
    await postEventNotification(input, config, fetcher);
    await postEventNotification(input, config, fetcher);
    expect(fetcher.mock.calls.map((call) => call[1].headers["Idempotency-Key"]))
      .toEqual([
        "demandradar/event-notification/batch-1",
        "demandradar/event-notification/batch-1",
      ]);
  });

  it.each([
    [400, false],
    [408, true],
    [429, true],
    [503, true],
  ])("classifies Resend status %i without reading or logging its body", async (status, retryable) => {
    const fetcher = vi.fn().mockResolvedValue(new Response("private provider message", { status }));
    await expect(postEventNotification(input, config, fetcher)).resolves.toEqual({
      accepted: false,
      status,
      retryable,
    });
  });

  it("surfaces an uncertain network failure for queue retry", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("connection reset"));
    await expect(postEventNotification(input, config, fetcher)).rejects.toThrow("connection reset");
  });

  it("stops automatic retries before Resend forgets the key", () => {
    const now = new Date("2026-09-15T12:00:00.000Z");
    expect(
      notificationRetryExpired("2026-09-14T13:00:01.000Z", now),
    ).toBe(false);
    expect(
      notificationRetryExpired("2026-09-14T13:00:00.000Z", now),
    ).toBe(true);
  });
});
