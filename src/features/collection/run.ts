import { distanceKm } from "@/features/events/distance";
import {
  applyDemandTriage,
  applyEvidenceReview,
  asProvisional,
  demandReviewFingerprint,
  prefilterHotelDemand,
  type DemandTriage,
  type EvidenceReview,
} from "@/features/events/hotel-demand";
import type { EventCandidate, SourceName } from "@/features/events/types";

import {
  collectClaude,
  triagePredictHqCandidates,
  verifyPredictHqCandidates,
  type ClaudeUsageEvent,
} from "./sources/claude";
import { collectFootballdata } from "./sources/footballdata";
import { collectOpenHolidays } from "./sources/openholidays";
import { collectPredictHq } from "./sources/predicthq";
import { collectRijksoverheid } from "./sources/rijksoverheid";
import { collectTicketmaster } from "./sources/ticketmaster";
import type { CollectionWindow, SourceResult } from "./types";

export type CollectionAreaContext = {
  id: string;
  accountId: string;
  name: string;
  searchLocation: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  enabledSources: SourceName[];
};

export type HotelContext = {
  id: string;
  latitude: number;
  longitude: number;
  demandRadiusKm: number;
  holidayRegion: string | null;
};

export type CollectionContext = {
  area: CollectionAreaContext;
  hotels: HotelContext[];
  window: CollectionWindow;
  knownClaudeUrls: string[];
  knownEvents: { title: string; startDate: string; endDate: string | null }[];
};

type ClaudeSourceRow = {
  source_url: string;
  extracted_start_at: string;
  extracted_end_at: string | null;
  checked_at: string;
};

export function collectionWindow(now = new Date()): CollectionWindow {
  const end = new Date(now);
  end.setUTCDate(end.getUTCDate() + 90);
  return {
    start: now.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

export function claudeDiscoveryDue(
  lastFinishedAt: string | null,
  now = new Date(),
) {
  return (
    !lastFinishedAt ||
    now.getTime() - new Date(lastFinishedAt).getTime() >=
      30 * 24 * 60 * 60 * 1000
  );
}

export function selectClaudeRefreshUrls(
  rows: ClaudeSourceRow[],
  window: CollectionWindow,
  limit = 8,
) {
  return [
    ...new Map(
      rows
        .filter(
          (row) =>
            row.extracted_start_at.slice(0, 10) <= window.end &&
            (row.extracted_end_at ?? row.extracted_start_at).slice(0, 10) >=
              window.start,
        )
        .sort((left, right) => left.checked_at.localeCompare(right.checked_at))
        .map((row) => [row.source_url, row] as const),
    ).keys(),
  ].slice(0, limit);
}

export type PersistResult = {
  state: "active" | "needs_review" | "excluded";
  duplicate: boolean;
  eventId?: string;
};
export type StoredDemandTriage = DemandTriage & { fingerprint: string };
export type StoredEvidenceReview = EvidenceReview & { fingerprint: string };

export type CollectionRepository = {
  startRun: (input: RunCollectionInput) => Promise<string>;
  loadContext: (
    accountId: string,
    areaId: string
  ) => Promise<CollectionContext>;
  persistCandidate: (
    context: CollectionContext,
    candidate: EventCandidate
  ) => Promise<PersistResult>;
  loadDemandTriages: (
    context: CollectionContext,
    candidates: EventCandidate[]
  ) => Promise<Record<string, StoredDemandTriage>>;
  saveDemandTriages: (
    context: CollectionContext,
    reviews: StoredDemandTriage[]
  ) => Promise<void>;
  loadEvidenceReviews: (
    candidates: EventCandidate[]
  ) => Promise<Record<string, StoredEvidenceReview>>;
  saveEvidenceReviews: (reviews: StoredEvidenceReview[]) => Promise<void>;
  hideCandidates: (
    context: CollectionContext,
    candidates: EventCandidate[]
  ) => Promise<void>;
  shouldRunClaudeDiscovery: (context: CollectionContext) => Promise<boolean>;
  recalculateScores: (context: CollectionContext) => Promise<void>;
  recordUsage: (
    runId: string,
    source: SourceName,
    usage: ClaudeUsageEvent
  ) => Promise<void>;
  finishRun: (
    runId: string,
    sourceResults: Record<string, unknown>,
    costUsage: Record<string, number>,
    errorSummary?: string
  ) => Promise<void>;
};

type Collector = (context: CollectionContext) => Promise<SourceResult>;
type DemandTriageReviewer = (input: {
  candidates: EventCandidate[];
  hotelName: string;
  location: string;
  radiusKm: number;
  distancesKm?: Record<string, number>;
}) => Promise<{
  reviews: DemandTriage[];
  requests: number;
  usage: Record<string, number>;
}>;
type EvidenceReviewer = (input: {
  candidates: EventCandidate[];
  hotelName: string;
  location: string;
  radiusKm: number;
}) => Promise<{
  reviews: EvidenceReview[];
  requests: number;
  usage: Record<string, number>;
}>;
type RunDependencies = {
  repository: CollectionRepository;
  collectors: Partial<Record<SourceName, Collector>>;
  demandTriageReviewer?: DemandTriageReviewer;
  evidenceReviewer?: EvidenceReviewer;
};
export type RunCollectionInput = {
  accountId: string;
  areaId: string;
  trigger: "cron" | "manual";
};
export type CollectionRunSummary = {
  runId: string;
  status: "completed" | "partial" | "already_running";
  sourceResults: Record<string, unknown>;
};

class SourceUnavailableError extends Error {
  constructor(public state: "disabled" | "unlicensed", message: string) {
    super(message);
  }
}

function configured(value: string | undefined, source: string) {
  if (!value)
    throw new SourceUnavailableError(
      "unlicensed",
      `${source} credentials are missing.`
    );
  return value;
}

function defaultCollectors(
  onUsage: (source: SourceName, usage: ClaudeUsageEvent) => Promise<void>
): Partial<Record<SourceName, Collector>> {
  return {
    rijksoverheid: (context) => collectRijksoverheid(context.window),
    openholidays: (context) => collectOpenHolidays(context.window),
    ticketmaster: (context) =>
      collectTicketmaster({
        ...context.window,
        city: context.area.searchLocation,
        latitude: context.area.latitude,
        longitude: context.area.longitude,
        radiusKm: context.area.radiusKm,
        apiKey: configured(process.env.TICKETMASTER_API_KEY, "Ticketmaster"),
      }),
    predicthq: (context) =>
      collectPredictHq({
        ...context.window,
        latitude: context.area.latitude,
        longitude: context.area.longitude,
        radiusKm: context.area.radiusKm,
        accessToken: configured(
          process.env.PREDICTHQ_ACCESS_TOKEN,
          "PredictHQ"
        ),
      }),
    claude: (context) => {
      configured(process.env.ANTHROPIC_API_KEY, "Anthropic");
      return collectClaude({
        ...context.window,
        location: context.area.searchLocation,
        radiusKm: context.area.radiusKm,
        knownUrls: context.knownClaudeUrls,
        knownEvents: context.knownEvents,
        onUsage: (usage) => onUsage("claude", usage),
      });
    },
    footballdata: (context) =>
      collectFootballdata({
        ...context.window,
        apiKey: configured(process.env.FOOTBALLDATA_API_KEY, "Football Data"),
      }),
    uefa: () => Promise.resolve({ source: "uefa", candidates: [], requests: 0, usage: {} }),
  };
}

function defaultDemandTriageReviewer(
  onUsage: (source: SourceName, usage: ClaudeUsageEvent) => Promise<void>
): DemandTriageReviewer {
  return (input) => {
    configured(process.env.ANTHROPIC_API_KEY, "Anthropic");
    return triagePredictHqCandidates({
      ...input,
      onUsage: (usage) => onUsage("predicthq", usage),
    });
  };
}

function defaultEvidenceReviewer(
  onUsage: (source: SourceName, usage: ClaudeUsageEvent) => Promise<void>
): EvidenceReviewer {
  return (input) => {
    configured(process.env.ANTHROPIC_API_KEY, "Anthropic");
    return verifyPredictHqCandidates({
      ...input,
      onUsage: (usage) => onUsage("predicthq", usage),
    });
  };
}

function relevantToHotel(candidate: EventCandidate, hotel: HotelContext) {
  if (candidate.category === "school_holiday")
    return candidate.regionScope === hotel.holidayRegion;
  if (candidate.category === "public_holiday") return true;
  if (candidate.latitude === null || candidate.longitude === null) return false;
  return (
    distanceKm(
      hotel.latitude,
      hotel.longitude,
      candidate.latitude,
      candidate.longitude
    ) <= hotel.demandRadiusKm
  );
}

function errorState(reason: unknown) {
  if (reason instanceof SourceUnavailableError)
    return { state: reason.state, error: reason.message };
  return { state: "failed", error: errorMessage(reason) };
}

function errorMessage(reason: unknown) {
  if (reason instanceof Error) return reason.message;
  if (
    reason &&
    typeof reason === "object" &&
    "message" in reason &&
    typeof reason.message === "string"
  )
    return reason.message;
  return String(reason);
}

export async function runCollection(
  input: RunCollectionInput,
  dependencies?: RunDependencies
): Promise<CollectionRunSummary> {
  const repository =
    dependencies?.repository ??
    (await import("./repository")).createCollectionRepository();
  let runId: string;
  try {
    runId = await repository.startRun(input);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return { runId: "", status: "already_running", sourceResults: {} };
    }
    throw error;
  }

  const sourceResults: Record<string, unknown> = {};
  const usage: Record<string, number> = {};
  let failed = false;
  let fatalError: unknown;

  try {
    const context = await repository.loadContext(input.accountId, input.areaId);
    const observeUsage = (source: SourceName, event: ClaudeUsageEvent) =>
      repository.recordUsage(runId, source, event);
    const collectors =
      dependencies?.collectors ?? defaultCollectors(observeUsage);
    const demandTriageReviewer = dependencies
      ? dependencies.demandTriageReviewer
      : defaultDemandTriageReviewer(observeUsage);
    const evidenceReviewer = dependencies
      ? dependencies.evidenceReviewer
      : defaultEvidenceReviewer(observeUsage);
    const sourcesToRun: SourceName[] = [];
    for (const source of context.area.enabledSources) {
      if (
        source === "claude" &&
        input.trigger === "cron" &&
        !(await repository.shouldRunClaudeDiscovery(context))
      ) {
        sourceResults.claude = {
          state: "skipped",
          reason: "Claude discovery runs at most once every 30 days.",
        };
      } else {
        sourcesToRun.push(source);
      }
    }
    const tasks = sourcesToRun.map(async (source) => {
      const collector = collectors[source];
      if (!collector)
        throw new SourceUnavailableError(
          "disabled",
          `${source} is not configured.`
        );
      return collector(context);
    });
    const settled = await Promise.allSettled(tasks);

    for (let index = 0; index < settled.length; index += 1) {
      const source = sourcesToRun[index];
      const result = settled[index];
      if (result.status === "rejected") {
        failed = true;
        sourceResults[source] = errorState(result.reason);
        continue;
      }

      const relevant = result.value.candidates.filter((event) =>
        context.hotels.some((hotel) => relevantToHotel(event, hotel))
      );
      const missingLocationCount = result.value.candidates.filter(
        (event) =>
          !["school_holiday", "public_holiday"].includes(event.category) &&
          (event.latitude === null || event.longitude === null)
      ).length;
      const unique = new Map(
        relevant.map((event) => [
          `${event.provider}:${event.providerEventId}`,
          event,
        ])
      );
      let candidates = [...unique.values()];
      let hiddenCount = 0;
      let cachedCount = 0;
      let provisionalCount = 0;
      let triageRequests = 0;
      let verificationRequests = 0;
      let sourceError: string | null = null;
      const sourceUsage = { ...result.value.usage };

      if (source === "predicthq") {
        const direct: EventCandidate[] = [];
        const directProvisional: EventCandidate[] = [];
        const toTriage: EventCandidate[] = [];
        const hidden: EventCandidate[] = [];
        for (const event of candidates) {
          const decision = prefilterHotelDemand(event);
          if (decision.action === "persist") direct.push(event);
          if (decision.action === "provisional")
            directProvisional.push(
              asProvisional(
                event,
                "Voorlopig vraagmoment op basis van een bekende competitiekalender."
              )
            );
          if (decision.action === "triage") toTriage.push(event);
          if (decision.action === "exclude") hidden.push(event);
        }

        const cached = await repository.loadDemandTriages(context, toTriage);
        const stale = toTriage.filter(
          (event) =>
            cached[event.providerEventId]?.fingerprint !==
            demandReviewFingerprint(event)
        );
        const triages = new Map<string, StoredDemandTriage>();
        toTriage.forEach((event) => {
          const review = cached[event.providerEventId];
          if (review?.fingerprint === demandReviewFingerprint(event)) {
            triages.set(event.providerEventId, review);
            cachedCount += 1;
          }
        });

        if (stale.length) {
          if (!demandTriageReviewer) {
            failed = true;
            sourceResults[source] = {
              state: "unlicensed",
              error: "Anthropic is required to triage PredictHQ candidates.",
            };
            continue;
          }
          let triaged: Awaited<ReturnType<DemandTriageReviewer>>;
          try {
            triaged = await demandTriageReviewer({
              candidates: stale,
              hotelName: context.area.name,
              location: context.area.searchLocation,
              radiusKm: context.area.radiusKm,
              distancesKm: Object.fromEntries(
                stale.flatMap((event) =>
                  event.latitude === null || event.longitude === null
                    ? []
                    : [
                        [
                          event.providerEventId,
                          distanceKm(
                            context.area.latitude,
                            context.area.longitude,
                            event.latitude,
                            event.longitude
                          ),
                        ],
                      ]
                )
              ),
            });
          } catch (error) {
            failed = true;
            sourceResults[source] = errorState(error);
            continue;
          }
          triageRequests = triaged.requests;
          Object.entries(triaged.usage).forEach(([key, value]) => {
            sourceUsage[key] = (sourceUsage[key] ?? 0) + value;
          });
          const staleById = new Map(
            stale.map((event) => [event.providerEventId, event])
          );
          const fresh = triaged.reviews.flatMap((review) => {
            const event = staleById.get(review.providerEventId);
            return event
              ? [{ ...review, fingerprint: demandReviewFingerprint(event) }]
              : [];
          });
          await repository.saveDemandTriages(context, fresh);
          fresh.forEach((review) =>
            triages.set(review.providerEventId, review)
          );
        }

        const provisional = [...directProvisional];
        const toVerify: EventCandidate[] = [];
        for (const event of toTriage) {
          const review = triages.get(event.providerEventId);
          if (!review || review.decision === "exclude") hidden.push(event);
          const assessed = review ? applyDemandTriage(event, review) : event;
          if (review?.decision === "provisional")
            provisional.push(asProvisional(assessed, review.evidenceText));
          if (review?.decision === "verify") toVerify.push(assessed);
        }

        const evidence = new Map<string, StoredEvidenceReview>();
        const cachedEvidence = await repository.loadEvidenceReviews(toVerify);
        const missingEvidence: EventCandidate[] = [];
        toVerify.forEach((event) => {
          const review = cachedEvidence[event.providerEventId];
          if (review?.fingerprint === demandReviewFingerprint(event)) {
            evidence.set(event.providerEventId, review);
            cachedCount += 1;
          } else {
            missingEvidence.push(event);
          }
        });

        const verificationQueue = missingEvidence.slice(0, 5);
        missingEvidence
          .slice(5)
          .forEach((event) =>
            provisional.push(
              asProvisional(
                event,
                "Webcontrole uitgesteld door de limiet van vijf controles per run."
              )
            )
          );
        if (verificationQueue.length) {
          if (!evidenceReviewer) {
            verificationQueue.forEach((event) =>
              provisional.push(
                asProvisional(
                  event,
                  "Nog niet via een openbare bron gecontroleerd."
                )
              )
            );
            failed = true;
            sourceError =
              "Anthropic is required to verify High/Piek PredictHQ candidates.";
          } else {
            const verificationErrors: string[] = [];
            for (const event of verificationQueue) {
              let requestCounted = false;
              try {
                const verified = await evidenceReviewer({
                  candidates: [event],
                  hotelName: context.area.name,
                  location: context.area.searchLocation,
                  radiusKm: context.area.radiusKm,
                });
                verificationRequests += Math.max(1, verified.requests);
                requestCounted = true;
                Object.entries(verified.usage).forEach(([key, value]) => {
                  sourceUsage[key] = (sourceUsage[key] ?? 0) + value;
                });
                const fresh = verified.reviews.flatMap((review) =>
                  review.providerEventId === event.providerEventId
                    ? [{ ...review, fingerprint: demandReviewFingerprint(event) }]
                    : []
                );
                if (!fresh.length) {
                  throw new Error("Claude gaf geen bruikbaar verificatieresultaat.");
                }
                await repository.saveEvidenceReviews(fresh);
                fresh.forEach((review) =>
                  evidence.set(review.providerEventId, review)
                );
              } catch (error) {
                failed = true;
                if (!requestCounted) verificationRequests += 1;
                verificationErrors.push(errorMessage(error));
                provisional.push(
                  asProvisional(event, "Webcontrole kon niet worden afgerond.")
                );
              }
            }
            if (verificationErrors.length) {
              sourceError = `${verificationErrors.length} van ${verificationQueue.length} webcontroles mislukt. ${verificationErrors[0]}`;
            }
          }
        }

        const verifiedCandidates: EventCandidate[] = [];
        for (const event of toVerify) {
          const review = evidence.get(event.providerEventId);
          if (review?.decision === "verified")
            verifiedCandidates.push(applyEvidenceReview(event, review));
          if (review?.decision === "unverifiable")
            provisional.push(asProvisional(event, review.evidenceText));
          if (
            !review &&
            !provisional.some(
              (candidate) => candidate.providerEventId === event.providerEventId
            )
          ) {
            provisional.push(
              asProvisional(
                event,
                "Nog niet via een openbare bron gecontroleerd."
              )
            );
          }
        }
        await repository.hideCandidates(context, hidden);
        hiddenCount = hidden.length;
        provisionalCount = provisional.length;
        candidates = [...direct, ...verifiedCandidates, ...provisional];
      }

      let reviewCount = 0;
      let duplicateCount = relevant.length - unique.size;
      const canonicalIds = new Set<string>();
      const canonicalReviewIds = new Set<string>();
      for (const event of candidates) {
        const persisted = await repository.persistCandidate(context, event);
        if (persisted.state === "needs_review") reviewCount += 1;
        if (persisted.eventId) canonicalIds.add(persisted.eventId);
        if (persisted.state === "needs_review" && persisted.eventId)
          canonicalReviewIds.add(persisted.eventId);
        if (persisted.duplicate) duplicateCount += 1;
      }
      Object.entries(sourceUsage).forEach(([key, value]) => {
        usage[key] = (usage[key] ?? 0) + value;
      });
      sourceResults[source] = {
        state: sourceError ? "partial" : candidates.length ? "success" : "zero",
        ...(sourceError ? { error: sourceError } : {}),
        candidates: candidates.length,
        found: result.value.candidates.length,
        unique: canonicalIds.size || candidates.length,
        requests: result.value.requests + triageRequests + verificationRequests,
        triageRequests,
        verificationRequests,
        cached: cachedCount,
        excluded: hiddenCount,
        provisional: provisionalCount,
        reviews: canonicalReviewIds.size || reviewCount,
        missingLocation: missingLocationCount,
        duplicates: duplicateCount,
        usage: sourceUsage,
        ...(result.value.funnel ? { funnel: result.value.funnel } : {}),
      };
    }
    await repository.recalculateScores(context);
  } catch (error) {
    failed = true;
    fatalError = error;
  } finally {
    await repository.finishRun(
      runId,
      sourceResults,
      usage,
      fatalError ? errorMessage(fatalError) : undefined
    );
  }

  if (fatalError) throw fatalError;
  return { runId, status: failed ? "partial" : "completed", sourceResults };
}
