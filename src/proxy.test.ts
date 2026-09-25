import { describe, expect, it } from "vitest";

import { isPublicPath, legacyRedirect } from "./proxy";

describe("isPublicPath", () => {
  it("allows platform-triggered endpoints without opening user APIs", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/api/cron/collect")).toBe(true);
    expect(isPublicPath("/api/queues/collect-hotel")).toBe(true);
    expect(isPublicPath("/api/webhooks/plugandpay")).toBe(true);
    expect(isPublicPath("/api/export")).toBe(false);
  });
});

describe("legacyRedirect", () => {
  const old = (path: string) => new URL(`https://demandradar-nu.vercel.app${path}`);

  it("sends old-address pages to the current address, keeping the page and its details", () => {
    expect(legacyRedirect(old("/open-calendar/abc?month=2027-07"), "https://app.demandradar.nl")?.toString())
      .toBe("https://app.demandradar.nl/open-calendar/abc?month=2027-07");
  });

  it("never redirects background calls, which do not follow redirects", () => {
    expect(legacyRedirect(old("/api/cron/collect"), "https://app.demandradar.nl")).toBeNull();
    expect(legacyRedirect(old("/api/webhooks/plugandpay"), "https://app.demandradar.nl")).toBeNull();
  });

  it("leaves the current address and a not-yet-moved setting alone", () => {
    expect(legacyRedirect(new URL("https://app.demandradar.nl/calendar"), "https://app.demandradar.nl")).toBeNull();
    expect(legacyRedirect(old("/calendar"), "https://demandradar-nu.vercel.app")).toBeNull();
  });
});
