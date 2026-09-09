import { describe, expect, it } from "vitest";
import { evaluateDemandAcceptance } from "./demand-acceptance";
const expected = [{ title: "Festival", match: "Festival", start: "2027-05-21", end: "2027-05-22" }];
const row = { title: "Festival", startAt: "2027-05-20T22:00:00Z", endAt: "2027-05-22T21:59:59Z" };
const input = { expected, negativePatterns: ["Tribute"], calendar: [row], traces: [], complete: true };
describe("automatic refresh acceptance", () => {
  it("requires the actual calendar edition and local dates", () => {
    expect(evaluateDemandAcceptance(input).passed).toBe(true);
    expect(evaluateDemandAcceptance({ ...input, calendar: [{ ...row, startAt: "2026-05-21" }] }).positives[0].stage).toBe("wrong_dates");
  });
  it("does not count supplied expectations or discovered candidates as publication", () => {
    const result = evaluateDemandAcceptance({ ...input, calendar: [], traces: [{ title: "Festival", stage: "demand", reason: "No travelling-audience evidence" }] });
    expect(result.passed).toBe(false);
    expect(result.positiveRecall).toBe(0);
    expect(result.positives[0].stage).toBe("demand");
  });
  it("fails negative controls and incomplete or mismatched recordings", () => {
    expect(evaluateDemandAcceptance({ ...input, calendar: [...input.calendar, { ...row, title: "Tribute" }] }).passed).toBe(false);
    expect(evaluateDemandAcceptance({ ...input, complete: false }).status).toBe("in_progress");
    expect(evaluateDemandAcceptance({ ...input, integrityErrors: ["Missing provider request"] }).passed).toBe(false);
  });
});
