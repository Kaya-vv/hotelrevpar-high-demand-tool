import { expect, it } from "vitest";
import { researchDue } from "./research-repair";
import type { Lead } from "./long-range-store";
import { searchDue, ANNOUNCEMENT_SEARCH_DAYS, CONFIRMED_RECHECK_DAYS, LEAD_RECHECK_DAYS, NEAR_TERM_SEARCH_DAYS } from "./schedule";

const first = "2026-09-21T15:45:00Z";

it("starts a new hotel immediately", () => {
  expect(searchDue(null, new Date(first), ANNOUNCEMENT_SEARCH_DAYS)).toBe(true);
});

it.each([
  ["announcement search", ANNOUNCEMENT_SEARCH_DAYS, "2026-09-27T23:59:59Z", "2026-09-28T05:00:00Z"],
  ["near-term search", NEAR_TERM_SEARCH_DAYS, "2026-10-04T23:59:59Z", "2026-10-05T05:00:00Z"],
  ["unfinished lead", LEAD_RECHECK_DAYS, "2026-10-20T23:59:59Z", "2026-10-21T05:00:00Z"],
  ["confirmed lead", CONFIRMED_RECHECK_DAYS, "2026-12-19T23:59:59Z", "2026-12-20T05:00:00Z"],
])("makes the %s due on the morning its interval ends, counted in calendar days", (_name, days, before, due) => {
  expect(searchDue(first, new Date(before), days)).toBe(false);
  expect(searchDue(first, new Date(due), days)).toBe(true);
});

it("counts a recent manual refresh and crosses month and year boundaries", () => {
  expect(searchDue("2026-12-28T21:00:00Z", new Date("2027-01-10T05:00:00Z"), NEAR_TERM_SEARCH_DAYS)).toBe(false);
  expect(searchDue("2026-12-28T21:00:00Z", new Date("2027-01-11T05:00:00Z"), NEAR_TERM_SEARCH_DAYS)).toBe(true);
});


it("includes a source checked in the afternoon in the next monthly morning run", () => {
  const lead = { nextCheck: "2026-10-05T16:45:00Z" } as Lead;
  expect(researchDue(lead, new Date("2026-10-04T23:59:59Z"))).toBe(false);
  expect(researchDue(lead, new Date("2026-10-05T05:00:00Z"))).toBe(true);
});
