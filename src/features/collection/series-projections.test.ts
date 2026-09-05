import { describe, expect, it } from "vitest";
import type { Lead } from "./long-range-store";
import { projectEditions, projectionInstructions, rememberEdition } from "./series-projections";

const lead = (): Lead => ({ key: "design", title: "Annual Design Week", kind: "event", group: 1,
  url: "https://organizer.example/about", outcome: "pending", nextCheck: "2026-09-05", checkedAt: null, editions: [], notes: [] });
describe("internal projected editions", () => {
  it("keeps estimates separate from confirmed editions and targets the year without supplying guessed dates to AI", () => {
    const series = lead();
    rememberEdition(series, { start: "2026-10-17", end: "2026-10-25", sourceUrl: series.url! });
    series.projections = projectEditions(series, "2026-12-05", "2027-12-31");
    expect(series.projections[0]).toMatchObject({ status: "projected", confidence: "low", start: "2027-10-17", end: "2027-10-25" });
    expect(series.editions).toEqual([]);
    expect(projectionInstructions(series)).toContain("2027");
    expect(projectionInstructions(series)).not.toContain("2027-10-17");
    rememberEdition(series, { start: "2027-10-23", end: "2027-10-31", sourceUrl: series.url! });
    expect(projectEditions(series, "2026-12-05", "2027-12-31")).toEqual([]);
  });
  it("clamps leap day and preserves duration across a year boundary", () => {
    const series = lead();
    rememberEdition(series, { start: "2024-02-29", end: "2024-03-01", sourceUrl: series.url! });
    expect(projectEditions(series, "2025-01-01", "2025-12-31")[0]).toMatchObject({ start: "2025-02-28", end: "2025-03-01" });
    rememberEdition(series, { start: "2024-12-31", end: "2025-01-02", sourceUrl: series.url! });
    expect(projectEditions(series, "2025-01-01", "2025-12-31")[0]).toMatchObject({ start: "2025-12-31", end: "2026-01-02" });
  });
  it("does not project a whole season, calendar hub or invalid historical range", () => {
    const series = lead();
    rememberEdition(series, { start: "2026-09-01", end: "2027-07-01", sourceUrl: series.url! });
    expect(projectEditions(series, "2027-01-01", "2028-12-31")).toEqual([]);
    series.lastKnownEdition = { start: "2026-02-30", end: "2026-03-02", sourceUrl: series.url! };
    expect(projectEditions(series, "2027-01-01", "2027-12-31")).toEqual([]);
    series.kind = "calendar";
    expect(projectEditions(series, "2027-01-01", "2027-12-31")).toEqual([]);
  });
  it("does not replace a sticky announcement page with another source for the same old edition", () => {
    const series = lead();
    rememberEdition(series, { start: "2026-10-17", end: "2026-10-25", sourceUrl: series.url! });
    rememberEdition(series, { start: "2026-10-17", end: "2026-10-25", sourceUrl: "https://organizer.example/" });
    expect(series.officialPage).toBe("https://organizer.example/about");
  });
});
