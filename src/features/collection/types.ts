import type { EventCandidate, SourceName } from "@/features/events/types";

export type CollectionWindow = { start: string; end: string };
export type Fetcher = typeof fetch;
export type DiscoveryDrop = { title: string; stage: "discovery" | "triage" | "resolution" | "verification"; reason: string };
export type DiscoveryFunnel = {
  namesDiscovered: number;
  urlsResolved: number;
  pagesVerified: number;
  demandAccepted: number;
  drops: DiscoveryDrop[];
};
export type SourceResult = {
  source: SourceName;
  candidates: EventCandidate[];
  requests: number;
  usage: Record<string, number>;
  invalidatedUrls?: string[];
  funnel?: DiscoveryFunnel;
  error?: string;
  quarantinedProviderEventIds?: string[];
};

