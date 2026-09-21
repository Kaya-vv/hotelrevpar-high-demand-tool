import { expect, it } from "vitest";
import { researchDue } from "./research-repair";
import type { Lead } from "./long-range-store";
import { searchDue, BROAD_SEARCH_INTERVAL_DAYS } from "./schedule";

it("starts a new hotel immediately, checks at two weeks, and searches broadly at four", () => {
  const first = "2026-09-21T15:45:00Z";
  expect(searchDue(null, new Date(first))).toBe(true);
  expect(searchDue(first, new Date("2026-09-28T05:00:00Z"))).toBe(false);
  expect(searchDue(first, new Date("2026-10-04T23:59:59Z"))).toBe(false);
  expect(searchDue(first, new Date("2026-10-05T05:00:00Z"))).toBe(true);
  expect(searchDue(first, new Date("2026-10-05T05:00:00Z"), BROAD_SEARCH_INTERVAL_DAYS)).toBe(false);
  expect(searchDue(first, new Date("2026-10-19T05:00:00Z"), BROAD_SEARCH_INTERVAL_DAYS)).toBe(true);
});

it("counts a recent manual refresh and crosses month and year boundaries", () => {
  expect(searchDue("2026-12-28T21:00:00Z", new Date("2027-01-10T05:00:00Z"))).toBe(false);
  expect(searchDue("2026-12-28T21:00:00Z", new Date("2027-01-11T05:00:00Z"))).toBe(true);
});


it("includes a source checked in the afternoon in the next fortnight's morning run", () => {
  const lead = { nextCheck: "2026-10-05T16:45:00Z" } as Lead;
  expect(researchDue(lead, new Date("2026-10-04T23:59:59Z"))).toBe(false);
  expect(researchDue(lead, new Date("2026-10-05T05:00:00Z"))).toBe(true);
});
