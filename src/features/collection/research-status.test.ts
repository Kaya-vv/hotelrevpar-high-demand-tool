import { expect, it } from "vitest";
import { researchIsPending } from "./research-status";

it("waits through queued research and publication, then completes", () => {
  const start = "2026-09-08T10:00:00Z";
  expect(researchIsPending(false, start, null)).toBe(false);
  expect(researchIsPending(true, start, null)).toBe(true);
  expect(researchIsPending(true, start, { publishedAt: "2026-09-07T10:00:00Z" })).toBe(true);
  expect(researchIsPending(true, start, { publicationPending: true })).toBe(true);
  expect(researchIsPending(true, start, { publishedAt: "2026-09-08T10:05:00Z", publicationPending: false })).toBe(false);
  expect(researchIsPending(true, start, { publishedAt: "2026-09-08T10:05:00Z", publicationPending: true, research: { requestedAt: "2026-09-08T11:00:00Z" } })).toBe(false);
});
