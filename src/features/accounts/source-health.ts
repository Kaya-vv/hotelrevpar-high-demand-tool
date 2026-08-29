import { createAdminClient } from "@/lib/supabase/admin";

import { currentSourceError } from "./source-health-state";

export type SourceHealth = {
  name: string;
  state: string;
  lastSuccess: string | null;
  currentError: string | null;
  found: number;
  unique: number;
  duplicates: number;
  reviews: number;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  webSearchRequests: number;
  webFetchRequests: number;
  usageCalls: number;
};

export type SourceHealthRun = {
  id: string;
  accountName: string;
  areaName: string;
  startedAt: string;
  finishedAt: string | null;
  errorSummary: string | null;
  sources: SourceHealth[];
};

type RawSource = {
  state?: string;
  error?: string;
  candidates?: number;
  found?: number;
  unique?: number;
  duplicates?: number;
  reviews?: number;
  requests?: number;
  usage?: Record<string, number>;
};

function sourceEntries(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, RawSource>);
}

export async function getSourceHealthRuns(): Promise<SourceHealthRun[]> {
  const admin = createAdminClient();
  const [runsResult, accountsResult, areasResult] = await Promise.all([
    admin.from("collection_runs").select("*").order("started_at", { ascending: false }).limit(100),
    admin.from("accounts").select("id, name"),
    admin.from("collection_areas").select("id, name, enabled_sources"),
  ]);
  if (runsResult.error) throw runsResult.error;
  if (accountsResult.error) throw accountsResult.error;
  if (areasResult.error) throw areasResult.error;

  const runIds = runsResult.data.map((run) => run.id);
  const usageResult = runIds.length
    ? await admin.from("collection_usage_events").select("collection_run_id, source, input_tokens, output_tokens, web_search_requests, web_fetch_requests").in("collection_run_id", runIds)
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
      errorSummary: run.error_summary === "[object Object]" ? "Run afgebroken door een technische fout" : run.error_summary,
      sources: sourceNames.map((name) => {
        const source = storedSources.get(name);
        const recordedUsage = usageByRunSource.get(`${run.id}:${name}`);
        return {
          name,
          state: source?.state ?? "not_run",
          lastSuccess: lastSuccess.get(`${run.account_id}:${run.collection_area_id}:${name}`) ?? null,
          currentError: currentSourceError(source, run.finished_at),
          found: source?.found ?? source?.candidates ?? 0,
          unique: source?.unique ?? source?.candidates ?? 0,
          duplicates: source?.duplicates ?? 0,
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

