import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SourceHealthTable } from "./page";

describe("SourceHealthTable", () => {
  it("shows collection and Anthropic usage evidence", () => {
    render(<SourceHealthTable runs={[{
      id: "run-1",
      accountName: "Robert",
      areaName: "Eindhoven",
      startedAt: "2027-08-27T05:00:00Z",
      finishedAt: "2027-08-27T05:01:00Z",
      errorSummary: null,
      sources: [{
        name: "claude",
        state: "success",
        lastSuccess: "2027-08-27T05:01:00Z",
        currentError: null,
        found: 12,
        unique: 10,
        duplicates: 2,
        reviews: 1,
        requests: 2,
        inputTokens: 300,
        outputTokens: 80,
        webSearchRequests: 1,
      }],
    }]} />);
    expect(screen.getByText("Robert")).toBeInTheDocument();
    expect(screen.getByText("Eindhoven")).toBeInTheDocument();
    expect(screen.getAllByText(/27-8-2027/)).toHaveLength(2);
    ["12", "10", "2", "1", "300", "80"].forEach((value) => expect(screen.getAllByText(value).length).toBeGreaterThan(0));
  });
});
