import { runStatusLabel } from "./source-health-table";
import { getMarketStatuses, getMarketProgress, marketKeyResolver } from "../collection/market-status";
import { fetchAllRows, fetchPagedInBatches } from "@/lib/supabase/fetch-in-batches";
import type { DiscoveryDrop, DiscoveryFunnel } from "@/features/collection/types";
import { createAdminClient } from "@/lib/supabase/admin";

import { currentSourceError } from "./source-health-state";
import { longRangeMarketKey, type LongRangeState } from "../collection/long-range-store";
import { researchIsPending } from "../collection/research-status";

export async function getMarketResearchHealth() {
  const admin = createAdminClient();
  const [markets, areas] = await Promise.all([
    getMarketStatuses().then(data => ({ data, error: null })),
    fetchAllRows((from, to) => admin.from("collection_areas").select("search_location, radius_km").order("id").range(from, to)).then(data => ({ data, error: null })),
  ]);
  if (markets.error) throw markets.error;
  if (areas.error) throw areas.error;
  return markets.data.flatMap((market) => {
    const state = market as unknown as LongRangeState;
    // The market now carries its own city and radius; an area lookup guessed wrong as soon as a
    // wider market served hotels whose own radius differed from it.
    const area = areas.data.find((area) => longRangeMarketKey(area.search_location, area.radius_km) === market.market_key);
    return state.research ? [{ key: market.market_key,
      city: market.search_location ?? area?.search_location ?? market.market_key.slice(0, 8),
      radius: market.radius_km ?? area?.radius_km,
      ...state.research, publishedAt: state.publishedAt, publicationPending: state.publicationPending,
      waves: Number(market.waves ?? 0), leads: Array.isArray(market.leadKeys) ? market.leadKeys.length : 0 }] : [];
  });
}

export type SourceHealth = {
  research?: Record<string, number>;
  name: string;
  state: string;
  lastSuccess: string | null;
  currentError: string | null;
  found: number;
  unique: number;
  duplicates: number;
  namesDiscovered: number;
  urlsResolved: number;
  pagesVerified: number;
  demandAccepted: number;
  drops: DiscoveryDrop[];
  reviews: number;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  webSearchRequests: number;
  webFetchRequests: number;
  usageCalls: number;
};

export type SourceHealthRun = {
  researchPending?: boolean;
  id: string;
  accountName: string;
  areaName: string;
  startedAt: string;
  finishedAt: string | null;
  errorSummary: string | null;
  sources: SourceHealth[];
};

type RawSource = {
  researchPending?: boolean;
  state?: string;
  error?: string;
  candidates?: number;
  found?: number;
  unique?: number;
  duplicates?: number;
  reviews?: number;
  requests?: number;
  usage?: Record<string, number>;
  funnel?: DiscoveryFunnel;
};

function sourceEntries(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, RawSource>);
}

export async function getSourceHealthRuns(page = 0, runId?: string): Promise<SourceHealthRun[]> {
  const admin = createAdminClient();
  const runQuery = admin.from("collection_runs").select("id, account_id, collection_area_id, started_at, finished_at, error_summary, source_results").order("started_at", { ascending: false }).order("id");
  const runsResult = await (runId ? runQuery.eq("id", runId).limit(1) : runQuery.range(page * 20, page * 20 + 19));
  if (runsResult.error) throw runsResult.error;
  if (!runsResult.data.length) return [];
  const [accountsResult, areasResult] = await Promise.all([
    admin.from("accounts").select("id, name").in("id", [...new Set(runsResult.data.map(run => run.account_id))]),
    admin.from("collection_areas").select("id, name, enabled_sources, search_location, radius_km").in("id", [...new Set(runsResult.data.map(run => run.collection_area_id))]),
  ]);
  if (accountsResult.error) throw accountsResult.error;
  if (areasResult.error) throw areasResult.error;
  const marketKey = await marketKeyResolver();
  const markets = await getMarketProgress(areasResult.data.map(area => marketKey(area.search_location, area.radius_km)));

  const runIds = runsResult.data.map((run) => run.id);
  const usageResult = runIds.length
    ? { data: await fetchPagedInBatches(runIds, (ids, from, to) => admin.from("collection_usage_events").select("collection_run_id, source, input_tokens, output_tokens, web_search_requests, web_fetch_requests").in("collection_run_id", ids).order("id").range(from, to)), error: null }
    : { data: [], error: null };
  if (usageResult.error) throw usageResult.error;
  const usageByRunSource = new Map<string, { calls: number; inputTokens: number; outputTokens: number; webSearchRequests: number; webFetchRequests: number }>();
  usageResult.data.forEach((item) => {
    const key = `${item.collection_run_id}:${item.source}`;
    const aggregate = usageByRunSource.get(key) ?? { calls: 0, inputTokens: 0, outputTokens: 0, webSearchRequests: 0, webFetchRequests: 0 };
    aggregate.calls += 1;
    aggregate.inputTokens += item.input_tokens;
    aggregate.outputTokens += item.output_tokens;
    aggregate.webSearchRequests += item.web_search_requests;
    aggregate.webFetchRequests += item.web_fetch_requests;
    usageByRunSource.set(key, aggregate);
  });

  const accounts = new Map(accountsResult.data.map((account) => [account.id, account.name]));
  const areas = new Map(areasResult.data.map((area) => [area.id, area]));
  const lastSuccess = new Map<string, string>();
  runsResult.data.forEach((run) => {
    sourceEntries(run.source_results).forEach(([name, source]) => {
      const key = `${run.account_id}:${run.collection_area_id}:${name}`;
      if (!lastSuccess.has(key) && ["success", "zero"].includes(source.state ?? "") && run.finished_at) {
        lastSuccess.set(key, run.finished_at);
      }
    });
  });

  if (runId) {
    // Detail reads are on demand, but "last success" must still include earlier runs.
    const { data: history, error } = await admin.from("collection_runs")
      .select("account_id, collection_area_id, finished_at, claude:source_results->claude->>state, ticketmaster:source_results->ticketmaster->>state, predicthq:source_results->predicthq->>state, rijksoverheid:source_results->rijksoverheid->>state, openholidays:source_results->openholidays->>state, footballdata:source_results->footballdata->>state, uefa:source_results->uefa->>state")
      .eq("collection_area_id", runsResult.data[0].collection_area_id)
      .order("started_at", { ascending: false }).limit(100);
    if (error) throw error;
    lastSuccess.clear();
    for (const row of history) for (const name of ["claude", "ticketmaster", "predicthq", "rijksoverheid", "openholidays", "footballdata", "uefa"] as const) {
      const key = `${row.account_id}:${row.collection_area_id}:${name}`;
      if (!lastSuccess.has(key) && row.finished_at && ["success", "zero"].includes(row[name] ?? "")) lastSuccess.set(key, row.finished_at);
    }
  }

  return runsResult.data.map((run) => {
    const area = areas.get(run.collection_area_id);
    const storedSources = new Map(sourceEntries(run.source_results));
    const sourceNames = area?.enabled_sources ?? [...storedSources.keys()];
    return {
      id: run.id,
      accountName: accounts.get(run.account_id) ?? "Onbekend account",
      areaName: area?.name ?? "Onbekende regio",
      startedAt: run.started_at,
      finishedAt: run.finished_at,
      researchPending: researchIsPending(Boolean(storedSources.get("claude")?.researchPending), run.started_at,
        area ? markets.get(marketKey(area.search_location, area.radius_km)) : null),
      errorSummary: run.error_summary === "[object Object]" ? "Run afgebroken door een technische fout" : run.error_summary,
      sources: sourceNames.map((name) => {
        const source = storedSources.get(name);
        const recordedUsage = usageByRunSource.get(`${run.id}:${name}`);
        return {
          name,
          research: source?.usage,
          state: source?.state ?? "not_run",
          lastSuccess: lastSuccess.get(`${run.account_id}:${run.collection_area_id}:${name}`) ?? null,
          currentError: currentSourceError(source, run.finished_at),
          found: source?.found ?? source?.candidates ?? 0,
          unique: source?.unique ?? source?.candidates ?? 0,
          duplicates: source?.duplicates ?? 0,
          namesDiscovered: source?.funnel?.namesDiscovered ?? 0,
          urlsResolved: source?.funnel?.urlsResolved ?? 0,
          pagesVerified: source?.funnel?.pagesVerified ?? 0,
          demandAccepted: source?.funnel?.demandAccepted ?? 0,
          drops: source?.funnel?.drops ?? [],
          reviews: source?.reviews ?? 0,
          requests: source?.requests ?? 0,
          inputTokens: recordedUsage?.inputTokens ?? source?.usage?.inputTokens ?? 0,
          outputTokens: recordedUsage?.outputTokens ?? source?.usage?.outputTokens ?? 0,
          webSearchRequests: recordedUsage?.webSearchRequests ?? source?.usage?.webSearchRequests ?? 0,
          webFetchRequests: recordedUsage?.webFetchRequests ?? source?.usage?.webFetchRequests ?? 0,
          usageCalls: recordedUsage?.calls ?? 0,
        };
      }),
    };
  });
}


export type SourceHealthSummary = Pick<SourceHealthRun, "id" | "accountName" | "areaName" | "startedAt" | "finishedAt" | "researchPending"> & { label: string };

export async function getSourceHealthSummaries(page = 0): Promise<SourceHealthSummary[]> {
  const admin = createAdminClient();
  const { data: runs, error } = await admin.from("collection_runs")
    .select("id, account_id, collection_area_id, started_at, finished_at, error_summary, requested:source_results->claude->researchPending, claude:source_results->claude->>state, ticketmaster:source_results->ticketmaster->>state, predicthq:source_results->predicthq->>state, rijksoverheid:source_results->rijksoverheid->>state, openholidays:source_results->openholidays->>state, footballdata:source_results->footballdata->>state, uefa:source_results->uefa->>state")
    .order("started_at", { ascending: false }).order("id").range(page * 20, page * 20 + 19);
  if (error) throw error;
  if (!runs.length) return [];
  const [accounts, areas] = await Promise.all([
    admin.from("accounts").select("id, name").in("id", [...new Set(runs.map(run => run.account_id))]),
    admin.from("collection_areas").select("id, name, search_location, radius_km").in("id", [...new Set(runs.map(run => run.collection_area_id))]),
  ]);
  if (accounts.error) throw accounts.error;
  if (areas.error) throw areas.error;
  const marketKey = await marketKeyResolver();
  const markets = await getMarketProgress(areas.data.map(area => marketKey(area.search_location, area.radius_km)));
  return runs.map(run => {
    const area = areas.data.find(area => area.id === run.collection_area_id);
    const pending = researchIsPending(run.requested === true, run.started_at,
      area ? markets.get(marketKey(area.search_location, area.radius_km)) : undefined);
    const states = [run.claude, run.ticketmaster, run.predicthq, run.rijksoverheid, run.openholidays, run.footballdata, run.uefa]
      .map(state => ({ state: state ?? "not_run" }));
    return { id: run.id, accountName: accounts.data.find(account => account.id === run.account_id)?.name ?? "Onbekend account",
      areaName: area?.name ?? "Onbekende regio", startedAt: run.started_at, finishedAt: run.finished_at, researchPending: pending,
      label: runStatusLabel({ finishedAt: run.finished_at, researchPending: pending, errorSummary: run.error_summary === "[object Object]" ? "Run afgebroken door een technische fout" : run.error_summary, sources: states }) };
  });
}
