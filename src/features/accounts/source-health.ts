import { createAdminClient } from "@/lib/supabase/admin";

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
    admin.from("collection_areas").select("id, name"),
  ]);
  if (runsResult.error) throw runsResult.error;
  if (accountsResult.error) throw accountsResult.error;
  if (areasResult.error) throw areasResult.error;

  const accounts = new Map(accountsResult.data.map((account) => [account.id, account.name]));
  const areas = new Map(areasResult.data.map((area) => [area.id, area.name]));
  const lastSuccess = new Map<string, string>();
  runsResult.data.forEach((run) => {
    sourceEntries(run.source_results).forEach(([name, source]) => {
      const key = `${run.account_id}:${run.collection_area_id}:${name}`;
      if (!lastSuccess.has(key) && ["success", "zero"].includes(source.state ?? "") && run.finished_at) {
        lastSuccess.set(key, run.finished_at);
      }
    });
  });

  return runsResult.data.map((run) => ({
    id: run.id,
    accountName: accounts.get(run.account_id) ?? "Onbekend account",
    areaName: areas.get(run.collection_area_id) ?? "Onbekende regio",
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    errorSummary: run.error_summary,
    sources: sourceEntries(run.source_results).map(([name, source]) => ({
      name,
      state: source.state ?? "unknown",
      lastSuccess: lastSuccess.get(`${run.account_id}:${run.collection_area_id}:${name}`) ?? null,
      currentError: source.error ?? null,
      found: source.found ?? source.candidates ?? 0,
      unique: source.unique ?? source.candidates ?? 0,
      duplicates: source.duplicates ?? 0,
      reviews: source.reviews ?? 0,
      requests: source.requests ?? 0,
      inputTokens: source.usage?.inputTokens ?? 0,
      outputTokens: source.usage?.outputTokens ?? 0,
      webSearchRequests: source.usage?.webSearchRequests ?? 0,
    })),
  }));
}

