import { describe, expect, it, vi } from "vitest";

import type { EventCandidate } from "@/features/events/types";
import { demandReviewFingerprint } from "@/features/events/hotel-demand";

import {
  claudeDiscoveryDue,
  collectionWindow,
  runCollection,
  type CollectionRepository,
} from "./run";
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

it("uses a rolling 90-day collection window", () => {
  expect(collectionWindow(new Date("2026-09-01T12:00:00Z"))).toEqual({
    start: "2026-09-01",
    end: "2026-11-30",
  });
});

it("runs Claude discovery again after seven days", () => {
  const now = new Date("2026-09-01T12:00:00Z");
  expect(claudeDiscoveryDue(null, now)).toBe(true);
  expect(claudeDiscoveryDue("2026-08-26T12:00:01Z", now)).toBe(false);
  expect(claudeDiscoveryDue("2026-08-25T12:00:00Z", now)).toBe(true);
});

function repository(overrides: Partial<CollectionRepository> = {}): CollectionRepository {
  return {
    startRun: vi.fn().mockResolvedValue("run-1"),
    loadContext: vi.fn().mockResolvedValue({
      area: { id: "area-1", accountId: "account-1", name: "MATCH", searchLocation: "Eindhoven", latitude: 51.44, longitude: 5.48, radiusKm: 30, enabledSources: ["ticketmaster", "claude"] },
      hotels: [{ id: "hotel-1", latitude: 51.44, longitude: 5.48, demandRadiusKm: 25, holidayRegion: "south" }],
    }),
    persistCandidate: vi.fn().mockResolvedValue({ state: "active", duplicate: false }),
    loadDemandTriages: vi.fn().mockResolvedValue({}),
    saveDemandTriages: vi.fn().mockResolvedValue(undefined),
    loadEvidenceReviews: vi.fn().mockResolvedValue({}),
    saveEvidenceReviews: vi.fn().mockResolvedValue(undefined),
    hideCandidates: vi.fn().mockResolvedValue(undefined),
    shouldRunClaudeDiscovery: vi.fn().mockResolvedValue(true),
    recalculateScores: vi.fn().mockResolvedValue(undefined),
    recordUsage: vi.fn().mockResolvedValue(undefined),
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
        hotels: [{ id: "hotel-1", latitude: 51.44, longitude: 5.48, demandRadiusKm: 25, holidayRegion: "south" }],
      }),
    });
    await runCollection(
      { accountId: "account-1", areaId: "area-1", trigger: "manual" },
      { repository: repo, collectors: { ticketmaster: vi.fn().mockResolvedValue({ source: "ticketmaster", candidates: [candidate, { ...candidate, title: "Updated title" }], requests: 1, usage: {} }) } },
    );
    expect(repo.persistCandidate).toHaveBeenCalledTimes(1);
    expect(repo.persistCandidate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ title: "Updated title" }));
  });

  it("keeps only the hotel's school-holiday region and events inside its radius", async () => {
    const matchingHoliday = {
      ...candidate,
      providerEventId: "holiday-south",
      category: "school_holiday",
      latitude: null,
      longitude: null,
      regionScope: "south",
    };
    const repo = repository({
      loadContext: vi.fn().mockResolvedValue({
        area: { id: "area-1", accountId: "account-1", name: "MATCH", searchLocation: "Eindhoven", latitude: 51.44, longitude: 5.48, radiusKm: 25, enabledSources: ["ticketmaster"] },
        hotels: [{ id: "hotel-1", latitude: 51.44, longitude: 5.48, demandRadiusKm: 25, holidayRegion: "south" }],
      }),
    });

    await runCollection(
      { accountId: "account-1", areaId: "area-1", trigger: "manual" },
      {
        repository: repo,
        collectors: {
          ticketmaster: vi.fn().mockResolvedValue({
            source: "ticketmaster",
            candidates: [
              matchingHoliday,
              { ...matchingHoliday, providerEventId: "holiday-north", regionScope: "north" },
              { ...candidate, providerEventId: "unknown-distance", latitude: null, longitude: null },
              { ...candidate, providerEventId: "far-away", latitude: 52.1, longitude: 5.48 },
            ],
            requests: 1,
            usage: {},
          }),
        },
      },
    );

    expect(repo.persistCandidate).toHaveBeenCalledTimes(1);
    expect(repo.persistCandidate).toHaveBeenCalledWith(expect.anything(), matchingHoliday);
  });

  it("reviews a changed date without changing the canonical event", () => {
    expect(
      sourceChange(
        { extractedStartAt: candidate.startAt, extractedLocation: candidate.venue },
        { ...candidate, startAt: "2027-10-11T10:00:00Z" },
      ),
    ).toEqual({ conflict: "changed_date", preserveCanonical: true });
  });

  it("does not review the same instant written with a different timezone offset", () => {
    expect(
      sourceChange(
        { extractedStartAt: "2027-10-10T08:00:00+00:00", extractedLocation: candidate.venue },
        { ...candidate, startAt: "2027-10-10T10:00:00+02:00" },
      ),
    ).toEqual({ conflict: null, preserveCanonical: false });
  });

  it("stores a useful message when persistence rejects with a database error object", async () => {
    const databaseError = { message: "URI too long" };
    const repo = repository({ persistCandidate: vi.fn().mockRejectedValue(databaseError) });

    await expect(runCollection(
      { accountId: "account-1", areaId: "area-1", trigger: "manual" },
      { repository: repo, collectors: { ticketmaster: vi.fn().mockResolvedValue({ source: "ticketmaster", candidates: [candidate], requests: 1, usage: {} }) } },
    )).rejects.toBe(databaseError);

    expect(repo.finishRun).toHaveBeenCalledWith("run-1", {}, {}, "URI too long");
  });

  it("uses cheap triage before persisting Claude-verified hotel demand", async () => {
    const plausible = { ...candidate, provider: "predicthq" as const, providerEventId: "phq-major", category: "expos", localRank: 75, primarySourceConfirmed: false };
    const amateur = { ...plausible, providerEventId: "phq-amateur", category: "sports", attendance: 1500, localRank: 82 };
    const repo = repository({
      loadContext: vi.fn().mockResolvedValue({
        area: { id: "area-1", accountId: "account-1", name: "Testhotel", searchLocation: "Eindhoven", latitude: 51.44, longitude: 5.48, radiusKm: 25, enabledSources: ["predicthq"] },
        hotels: [{ id: "hotel-1", latitude: 51.44, longitude: 5.48, demandRadiusKm: 25, holidayRegion: "south" }],
      }),
    });
    const demandTriageReviewer = vi.fn().mockResolvedValue({
      reviews: [{ providerEventId: "phq-major", decision: "verify", confidence: "high", demandLevel: "high", evidenceText: "Landelijke vakbeurs." }],
      requests: 1,
      usage: { inputTokens: 100, outputTokens: 30, webSearchRequests: 0 },
    });
    const evidenceReviewer = vi.fn().mockResolvedValue({
      reviews: [{ providerEventId: "phq-major", decision: "verified", confidence: "high", sourceUrl: "https://organizer.nl/major", evidenceText: "Primaire bron bevestigd." }],
      requests: 1,
      usage: { inputTokens: 100, outputTokens: 30, webSearchRequests: 1 },
    });

    await runCollection(
      { accountId: "account-1", areaId: "area-1", trigger: "manual" },
      { repository: repo, collectors: { predicthq: vi.fn().mockResolvedValue({ source: "predicthq", candidates: [plausible, amateur], requests: 1, usage: {} }) }, demandTriageReviewer, evidenceReviewer },
    );

    expect(demandTriageReviewer).toHaveBeenCalledWith(expect.objectContaining({ candidates: [plausible], hotelName: "Testhotel" }));
    expect(evidenceReviewer).toHaveBeenCalledWith(expect.objectContaining({ candidates: [plausible], hotelName: "Testhotel" }));
    expect(repo.persistCandidate).toHaveBeenCalledTimes(1);
    expect(repo.persistCandidate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ providerEventId: "phq-major", publicSourceUrl: "https://organizer.nl/major", primarySourceConfirmed: true }));
    expect(repo.hideCandidates).toHaveBeenCalledWith(expect.anything(), [amateur]);
    expect(repo.saveDemandTriages).toHaveBeenCalledWith(expect.anything(), [expect.objectContaining({ fingerprint: demandReviewFingerprint(plausible) })]);
    expect(repo.saveEvidenceReviews).toHaveBeenCalledWith([expect.objectContaining({ fingerprint: demandReviewFingerprint(plausible) })]);
  });

  it("reuses unchanged hotel triage and global evidence without calling Claude", async () => {
    const plausible = { ...candidate, provider: "predicthq" as const, providerEventId: "phq-major", category: "expos", localRank: 75, primarySourceConfirmed: false };
    const cachedTriage = { providerEventId: plausible.providerEventId, fingerprint: demandReviewFingerprint(plausible), decision: "verify" as const, confidence: "high" as const, demandLevel: "high" as const, evidenceText: "Landelijke vakbeurs." };
    const cachedEvidence = { providerEventId: plausible.providerEventId, fingerprint: demandReviewFingerprint(plausible), decision: "verified" as const, confidence: "high" as const, sourceUrl: "https://organizer.nl/major", evidenceText: "Primaire bron bevestigd." };
    const repo = repository({
      loadContext: vi.fn().mockResolvedValue({
        area: { id: "area-1", accountId: "account-1", name: "Testhotel", searchLocation: "Eindhoven", latitude: 51.44, longitude: 5.48, radiusKm: 25, enabledSources: ["predicthq"] },
        hotels: [{ id: "hotel-1", latitude: 51.44, longitude: 5.48, demandRadiusKm: 25, holidayRegion: "south" }],
      }),
      loadDemandTriages: vi.fn().mockResolvedValue({ "phq-major": cachedTriage }),
      loadEvidenceReviews: vi.fn().mockResolvedValue({ "phq-major": cachedEvidence }),
    });
    const demandTriageReviewer = vi.fn();
    const evidenceReviewer = vi.fn();

    await runCollection(
      { accountId: "account-1", areaId: "area-1", trigger: "manual" },
      { repository: repo, collectors: { predicthq: vi.fn().mockResolvedValue({ source: "predicthq", candidates: [plausible], requests: 1, usage: {} }) }, demandTriageReviewer, evidenceReviewer },
    );

    expect(demandTriageReviewer).not.toHaveBeenCalled();
    expect(evidenceReviewer).not.toHaveBeenCalled();
    expect(repo.persistCandidate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ publicSourceUrl: cachedEvidence.sourceUrl }));
  });

  it("verifies five candidates per run and keeps overflow provisional", async () => {
    const candidates = Array.from({ length: 12 }, (_, index) => ({
      ...candidate,
      provider: "predicthq" as const,
      providerEventId: `phq-${index}`,
      category: "expos",
      localRank: 90,
      primarySourceConfirmed: false,
    }));
    const repo = repository({
      loadContext: vi.fn().mockResolvedValue({
        area: { id: "area-1", accountId: "account-1", name: "Testhotel", searchLocation: "Eindhoven", latitude: 51.44, longitude: 5.48, radiusKm: 25, enabledSources: ["predicthq"] },
        hotels: [{ id: "hotel-1", latitude: 51.44, longitude: 5.48, demandRadiusKm: 25, holidayRegion: "south" }],
      }),
    });
    const demandTriageReviewer = vi.fn().mockResolvedValue({
      reviews: candidates.map((event) => ({ providerEventId: event.providerEventId, decision: "verify" as const, confidence: "high" as const, demandLevel: "high" as const, evidenceText: "Groot evenement." })),
      requests: 1,
      usage: {},
    });
    const evidenceReviewer = vi.fn().mockImplementation(async ({ candidates: verificationCandidates }: { candidates: EventCandidate[] }) => ({
      reviews: verificationCandidates.map((event: EventCandidate) => ({ providerEventId: event.providerEventId, decision: "verified" as const, confidence: "high" as const, sourceUrl: `https://example.com/${event.providerEventId}`, evidenceText: "Bevestigd." })),
      requests: verificationCandidates.length,
      usage: {},
    }));

    const result = await runCollection(
      { accountId: "account-1", areaId: "area-1", trigger: "manual" },
      { repository: repo, collectors: { predicthq: vi.fn().mockResolvedValue({ source: "predicthq", candidates, requests: 1, usage: {} }) }, demandTriageReviewer, evidenceReviewer },
    );

    expect(evidenceReviewer).toHaveBeenCalledTimes(5);
    candidates.slice(0, 5).forEach((event, index) => {
      expect(evidenceReviewer).toHaveBeenNthCalledWith(
        index + 1,
        expect.objectContaining({ candidates: [event] }),
      );
    });
    expect(repo.saveEvidenceReviews).toHaveBeenCalledTimes(5);
    expect(repo.persistCandidate).toHaveBeenCalledTimes(12);
    expect(result.sourceResults.predicthq).toMatchObject({ verificationRequests: 5, provisional: 7 });
  });

  it("keeps and caches successful verifications when another candidate fails", async () => {
    const candidates = Array.from({ length: 3 }, (_, index) => ({
      ...candidate,
      provider: "predicthq" as const,
      providerEventId: `phq-${index}`,
      category: "expos",
      localRank: 90,
      primarySourceConfirmed: false,
    }));
    const repo = repository({
      loadContext: vi.fn().mockResolvedValue({
        area: { id: "area-1", accountId: "account-1", name: "Testhotel", searchLocation: "Eindhoven", latitude: 51.44, longitude: 5.48, radiusKm: 25, enabledSources: ["predicthq"] },
        hotels: [{ id: "hotel-1", latitude: 51.44, longitude: 5.48, demandRadiusKm: 25, holidayRegion: "south" }],
      }),
    });
    const demandTriageReviewer = vi.fn().mockResolvedValue({
      reviews: candidates.map((event) => ({ providerEventId: event.providerEventId, decision: "verify" as const, confidence: "high" as const, demandLevel: "high" as const, evidenceText: "Groot evenement." })),
      requests: 1,
      usage: {},
    });
    const evidenceReviewer = vi.fn().mockImplementation(async ({ candidates: [event] }: { candidates: EventCandidate[] }) => {
      if (event.providerEventId === "phq-1") throw new Error("token limit");
      return {
        reviews: [{ providerEventId: event.providerEventId, decision: "verified" as const, confidence: "high" as const, sourceUrl: `https://example.com/${event.providerEventId}`, evidenceText: "Bevestigd." }],
        requests: 1,
        usage: { inputTokens: 100, outputTokens: 30, webSearchRequests: 1 },
      };
    });

    const result = await runCollection(
      { accountId: "account-1", areaId: "area-1", trigger: "manual" },
      { repository: repo, collectors: { predicthq: vi.fn().mockResolvedValue({ source: "predicthq", candidates, requests: 1, usage: {} }) }, demandTriageReviewer, evidenceReviewer },
    );

    expect(result.status).toBe("partial");
    expect(result.sourceResults.predicthq).toMatchObject({ state: "partial", verificationRequests: 3, provisional: 1 });
    expect(repo.saveEvidenceReviews).toHaveBeenCalledTimes(2);
    expect(repo.saveEvidenceReviews).toHaveBeenNthCalledWith(1, [expect.objectContaining({ providerEventId: "phq-0" })]);
    expect(repo.saveEvidenceReviews).toHaveBeenNthCalledWith(2, [expect.objectContaining({ providerEventId: "phq-2" })]);
    expect(repo.persistCandidate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ providerEventId: "phq-0", primarySourceConfirmed: true }));
    expect(repo.persistCandidate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ providerEventId: "phq-1", certainty: "provisional" }));
    expect(repo.persistCandidate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ providerEventId: "phq-2", primarySourceConfirmed: true }));
  });

  it("runs Claude discovery at most once every 7 days", async () => {
    const claude = vi.fn();
    const repo = repository({
      shouldRunClaudeDiscovery: vi.fn().mockResolvedValue(false),
      loadContext: vi.fn().mockResolvedValue({
        area: { id: "area-1", accountId: "account-1", name: "Testhotel", searchLocation: "Eindhoven", latitude: 51.44, longitude: 5.48, radiusKm: 25, enabledSources: ["claude"] },
        hotels: [{ id: "hotel-1", latitude: 51.44, longitude: 5.48, demandRadiusKm: 25, holidayRegion: "south" }],
      }),
    });

    const result = await runCollection(
      { accountId: "account-1", areaId: "area-1", trigger: "manual" },
      { repository: repo, collectors: { claude } },
    );

    expect(claude).not.toHaveBeenCalled();
    expect(result.sourceResults.claude).toEqual({
      state: "skipped",
      reason: "Claude discovery runs at most once every 7 days.",
    });
  });
});
