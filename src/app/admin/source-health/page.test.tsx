import { render, screen, within } from "@testing-library/react";
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
        namesDiscovered: 24,
        urlsResolved: 14,
        pagesVerified: 11,
        demandAccepted: 9,
        drops: [{ title: "Weekmarkt", stage: "verification", reason: "Geen aantoonbare hotelvraag (impactPoints 20)." }],
        reviews: 1,
        requests: 2,
        inputTokens: 300,
        outputTokens: 80,
        webSearchRequests: 1,
        webFetchRequests: 1,
        usageCalls: 2,
      }],
    }]} />);
    expect(screen.getByText("Robert")).toBeInTheDocument();
    expect(screen.getByText("Eindhoven")).toBeInTheDocument();
    expect(screen.getAllByText(/27-8-2027/)).toHaveLength(2);
    ["12", "10", "2", "1", "300", "80", "24", "14", "11", "9"].forEach((value) => expect(screen.getAllByText(value).length).toBeGreaterThan(0));
    expect(screen.getByText(/1 afgewezen kandidaten/)).toBeInTheDocument();
    expect(screen.getByText(/Weekmarkt — verification/)).toBeInTheDocument();
    expect(screen.queryByText(/Run stopte voordat deze bron verwerkt kon worden/i)).not.toBeInTheDocument();
  });

  it("does not call an unfinished run completed", () => {
    const { container } = render(<SourceHealthTable runs={[{
      id: "run-active",
      accountName: "Robert",
      areaName: "Eindhoven",
      startedAt: "2027-08-27T05:00:00Z",
      finishedAt: null,
      errorSummary: null,
      sources: [{ name: "predicthq", state: "not_run", lastSuccess: null, currentError: null, found: 0, unique: 0, duplicates: 0, namesDiscovered: 0, urlsResolved: 0, pagesVerified: 0, demandAccepted: 0, drops: [], reviews: 0, requests: 0, inputTokens: 0, outputTokens: 0, webSearchRequests: 0, webFetchRequests: 0, usageCalls: 0 }],
    }]} />);

    expect(within(container).getByText("Bezig")).toBeInTheDocument();
    expect(within(container).getByText("Wachten")).toBeInTheDocument();
    expect(within(container).queryByText("Voltooid")).not.toBeInTheDocument();
  });

  it("calls a finished run with a partial provider partly completed", () => {
    const { container } = render(<SourceHealthTable runs={[{
      id: "run-partial",
      accountName: "Robert",
      areaName: "Eindhoven",
      startedAt: "2027-08-27T05:00:00Z",
      finishedAt: "2027-08-27T05:01:00Z",
      errorSummary: null,
      sources: [{ name: "predicthq", state: "partial", lastSuccess: null, currentError: "Een controle mislukte.", found: 20, unique: 18, duplicates: 2, namesDiscovered: 0, urlsResolved: 0, pagesVerified: 0, demandAccepted: 0, drops: [], reviews: 0, requests: 6, inputTokens: 300, outputTokens: 80, webSearchRequests: 5, webFetchRequests: 0, usageCalls: 6 }],
    }]} />);

    expect(within(container).getByText("Deels voltooid")).toBeInTheDocument();
    expect(within(container).queryByText("Voltooid")).not.toBeInTheDocument();
  });
});
