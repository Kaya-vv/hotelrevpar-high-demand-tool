import type { EventCandidate, SourceName } from "@/features/events/types";

export type CollectionWindow = { start: string; end: string };
export type Fetcher = typeof fetch;
export type SourceResult = {
  source: SourceName;
  candidates: EventCandidate[];
  requests: number;
  usage: Record<string, number>;
};

