import type { EventCandidate, SourceName } from "@/features/events/types";

import { collectClaude } from "./sources/claude";
import { collectOpenHolidays } from "./sources/openholidays";
import { collectPredictHq } from "./sources/predicthq";
import { collectRijksoverheid } from "./sources/rijksoverheid";
import { collectTicketmaster } from "./sources/ticketmaster";
import type { SourceResult } from "./types";

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
  window: { start: string; end: string };
};

export type PersistResult = { state: "active" | "needs_review" | "excluded"; duplicate: boolean };

export type CollectionRepository = {
  startRun: (input: RunCollectionInput) => Promise<string>;
  loadContext: (accountId: string, areaId: string) => Promise<CollectionContext>;
  persistCandidate: (context: CollectionContext, candidate: EventCandidate) => Promise<PersistResult>;
  finishRun: (runId: string, sourceResults: Record<string, unknown>, costUsage: Record<string, number>, errorSummary?: string) => Promise<void>;
};

type Collector = (context: CollectionContext) => Promise<SourceResult>;
type RunDependencies = { repository: CollectionRepository; collectors: Partial<Record<SourceName, Collector>> };
export type RunCollectionInput = { accountId: string; areaId: string; trigger: "cron" | "manual" };
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
  if (!value) throw new SourceUnavailableError("unlicensed", `${source} credentials are missing.`);
  return value;
}

function defaultCollectors(): Partial<Record<SourceName, Collector>> {
  return {
    rijksoverheid: (context) => collectRijksoverheid(context.window),
    openholidays: (context) => collectOpenHolidays(context.window),
    ticketmaster: (context) =>
      collectTicketmaster({
        ...context.window,
        city: context.area.searchLocation,
        apiKey: configured(process.env.TICKETMASTER_API_KEY, "Ticketmaster"),
      }),
    predicthq: (context) =>
      collectPredictHq({
        ...context.window,
        latitude: context.area.latitude,
        longitude: context.area.longitude,
        radiusKm: context.area.radiusKm,
        accessToken: configured(process.env.PREDICTHQ_ACCESS_TOKEN, "PredictHQ"),
      }),
    claude: (context) => {
      configured(process.env.ANTHROPIC_API_KEY, "Anthropic");
      return collectClaude({ ...context.window, location: context.area.searchLocation });
    },
  };
}

function errorState(reason: unknown) {
  if (reason instanceof SourceUnavailableError) return { state: reason.state, error: reason.message };
  return { state: "failed", error: reason instanceof Error ? reason.message : String(reason) };
}

export async function runCollection(
  input: RunCollectionInput,
  dependencies?: RunDependencies,
): Promise<CollectionRunSummary> {
  const repository = dependencies?.repository ?? (await import("./repository")).createCollectionRepository();
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
    const collectors = dependencies?.collectors ?? defaultCollectors();
    const tasks = context.area.enabledSources.map(async (source) => {
      const collector = collectors[source];
      if (!collector) throw new SourceUnavailableError("disabled", `${source} is not configured.`);
      return collector(context);
    });
    const settled = await Promise.allSettled(tasks);

    for (let index = 0; index < settled.length; index += 1) {
      const source = context.area.enabledSources[index];
      const result = settled[index];
      if (result.status === "rejected") {
        failed = true;
        sourceResults[source] = errorState(result.reason);
        continue;
      }

      const unique = new Map(result.value.candidates.map((event) => [`${event.provider}:${event.providerEventId}`, event]));
      let reviewCount = 0;
      let duplicateCount = result.value.candidates.length - unique.size;
      for (const event of unique.values()) {
        const persisted = await repository.persistCandidate(context, event);
        if (persisted.state === "needs_review") reviewCount += 1;
        if (persisted.duplicate) duplicateCount += 1;
      }
      Object.entries(result.value.usage).forEach(([key, value]) => {
        usage[key] = (usage[key] ?? 0) + value;
      });
      sourceResults[source] = {
        state: unique.size ? "success" : "zero",
        candidates: unique.size,
        found: result.value.candidates.length,
        unique: unique.size,
        requests: result.value.requests,
        reviews: reviewCount,
        duplicates: duplicateCount,
        usage: result.value.usage,
      };
    }
  } catch (error) {
    failed = true;
    fatalError = error;
  } finally {
    await repository.finishRun(
      runId,
      sourceResults,
      usage,
      fatalError instanceof Error ? fatalError.message : fatalError ? String(fatalError) : undefined,
    );
  }

  if (fatalError) throw fatalError;
  return { runId, status: failed ? "partial" : "completed", sourceResults };
}
