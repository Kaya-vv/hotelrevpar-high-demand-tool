import { describe, expect, it, vi } from "vitest";

import type { EventCandidate } from "@/features/events/types";

import { runCollection, type CollectionRepository } from "./run";
import { sourceChange } from "./source-change";

const candidate: EventCandidate = {
  provider: "ticketmaster",
  providerEventId: "tm-1",
  sourceUrl: "https://example.com/event",
  title: "Design Week",
  category: "festival",
  venue: "Klokgebouw",
  latitude: 51.44,
  longitude: 5.48,
  regionScope: null,
  startAt: "2027-10-10T10:00:00Z",
  endAt: "2027-10-10T22:00:00Z",
  sourceState: "active",
  certainty: "confirmed",
  localRank: null,
  attendance: 5000,
  venueCapacity: null,
  evidenceText: null,
  primarySourceConfirmed: true,
};

function repository(overrides: Partial<CollectionRepository> = {}): CollectionRepository {
  return {
    startRun: vi.fn().mockResolvedValue("run-1"),
    loadContext: vi.fn().mockResolvedValue({
      area: { id: "area-1", accountId: "account-1", name: "MATCH", searchLocation: "Eindhoven", latitude: 51.44, longitude: 5.48, radiusKm: 30, enabledSources: ["ticketmaster", "claude"] },
      hotels: [],
    }),
    persistCandidate: vi.fn().mockResolvedValue({ state: "active", duplicate: false }),
    finishRun: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("runCollection", () => {
  it("keeps successful candidates when one source fails", async () => {
    const repo = repository();
    const result = await runCollection(
      { accountId: "account-1", areaId: "area-1", trigger: "manual" },
      {
        repository: repo,
        collectors: {
          ticketmaster: vi.fn().mockResolvedValue({ source: "ticketmaster", candidates: [candidate], requests: 1, usage: {} }),
          claude: vi.fn().mockRejectedValue(new Error("provider unavailable")),
        },
      },
    );
    expect(result.status).toBe("partial");
    expect(repo.persistCandidate).toHaveBeenCalledWith(expect.anything(), candidate);
  });

  it("returns already_running for the native unique lock", async () => {
    const error = Object.assign(new Error("duplicate"), { code: "23505" });
    const result = await runCollection(
      { accountId: "account-1", areaId: "area-1", trigger: "manual" },
      { repository: repository({ startRun: vi.fn().mockRejectedValue(error) }), collectors: {} },
    );
    expect(result.status).toBe("already_running");
  });

  it("persists a repeated provider ID once per run", async () => {
    const repo = repository({
      loadContext: vi.fn().mockResolvedValue({
        area: { id: "area-1", accountId: "account-1", name: "MATCH", searchLocation: "Eindhoven", latitude: 51.44, longitude: 5.48, radiusKm: 30, enabledSources: ["ticketmaster"] },
        hotels: [],
      }),
    });
    await runCollection(
      { accountId: "account-1", areaId: "area-1", trigger: "manual" },
      { repository: repo, collectors: { ticketmaster: vi.fn().mockResolvedValue({ source: "ticketmaster", candidates: [candidate, { ...candidate, title: "Updated title" }], requests: 1, usage: {} }) } },
    );
    expect(repo.persistCandidate).toHaveBeenCalledTimes(1);
    expect(repo.persistCandidate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ title: "Updated title" }));
  });

  it("reviews a changed date without changing the canonical event", () => {
    expect(
      sourceChange(
        { extractedStartAt: candidate.startAt, extractedLocation: candidate.venue },
        { ...candidate, startAt: "2027-10-11T10:00:00Z" },
      ),
    ).toEqual({ conflict: "changed_date", preserveCanonical: true });
  });
});
