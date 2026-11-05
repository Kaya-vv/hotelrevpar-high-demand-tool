import { describe, expect, it, vi, type Mock } from "vitest";

import type { AdminClient } from "@/lib/supabase/admin";

import { createEventsHandler } from "./handlers";

vi.mock("server-only", () => ({}));

const url = "http://localhost/api/v1/events?from=2027-01-01&to=2027-12-31";
const validKey = `dr_live_${"a".repeat(43)}`;

/** A database whose every query answers with an error, as during an outage. */
function failingClient() {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "is", "order", "range", "update"]) builder[method] = () => builder;
  builder.maybeSingle = async () => ({ data: null, error: new Error("db down") });
  builder.single = builder.maybeSingle;
  return { from: vi.fn(() => builder) } as unknown as AdminClient & { from: Mock };
}

describe("public API events handler", () => {
  it("answers a database failure with 500, never with an empty 200 list RevControl would apply", async () => {
    const client = failingClient();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await createEventsHandler({ client: () => client })(new Request(url, { headers: { authorization: `Bearer ${validKey}` } }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "server_error", message: expect.any(String) } });
    expect(client.from).toHaveBeenCalledWith("api_keys");
    errorLog.mockRestore();
  });

  it("rejects a missing or malformed key without touching the database", async () => {
    const client = failingClient();
    const handler = createEventsHandler({ client: () => client });
    const headerSets: Record<string, string>[] = [{}, { authorization: "Bearer dr_live_short" }, { authorization: validKey }];
    for (const headers of headerSets) {
      const response = await handler(new Request(url, { headers }));
      expect(response.status).toBe(401);
      expect((await response.json()).error.code).toBe("unauthorized");
    }
    expect(client.from).not.toHaveBeenCalled();
  });

  it("reads the key whatever the letter case of the Bearer scheme", async () => {
    const client = failingClient();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await createEventsHandler({ client: () => client })(new Request(url, { headers: { authorization: `bearer ${validKey}` } }));
    expect(response.status).toBe(500);
    expect(client.from).toHaveBeenCalledWith("api_keys");
    errorLog.mockRestore();
  });
});
