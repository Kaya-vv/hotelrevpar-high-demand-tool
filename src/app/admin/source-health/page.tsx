import type { SourceHealthRun } from "@/features/accounts/source-health";
import { RefreshAllForm } from "@/features/collection/refresh-all-form";
import { RefreshHotelForm } from "@/features/collection/refresh-hotel-form";

export function runStatusLabel(run: SourceHealthRun) {
  if (!run.finishedAt) return "Bezig";
  if (run.errorSummary) return run.errorSummary;
  return run.sources.some((source) =>
    ["partial", "error", "failed", "unlicensed"].includes(source.state)
  )
    ? "Deels voltooid"
    : "Voltooid";
}

export function SourceHealthTable({ runs }: { runs: SourceHealthRun[] }) {
  return (
    <div className="health-list">
      {runs.map((run) => (
        <details className="panel" key={run.id}>
          <summary><strong>{run.accountName}</strong><span>{run.areaName}</span><span>{new Date(run.startedAt).toLocaleString("nl-NL")}</span><span>{runStatusLabel(run)}</span></summary>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Bron</th><th>Status</th><th>Laatste succes</th><th>Fout</th><th>Gevonden</th><th>Uniek</th><th>Duplicaten</th><th>Namen</th><th>Officiële URL&apos;s</th><th>Geverifieerd</th><th>High/Piek</th><th>Review</th><th>Requests</th><th>AI-calls</th><th>Input</th><th>Output</th><th>Search</th><th>Fetch</th></tr></thead>
              <tbody>{run.sources.map((source) => (
                <tr key={source.name}>
                  <td>{source.name}</td><td>{!run.finishedAt && source.state === "not_run" ? "Wachten" : source.state}</td><td>{source.lastSuccess ? new Date(source.lastSuccess).toLocaleString("nl-NL") : "Geen"}</td><td>{source.currentError ?? ""}</td>
                  <td>{source.found}</td><td>{source.unique}</td><td>{source.duplicates}</td><td>{source.namesDiscovered}</td><td>{source.urlsResolved}</td><td>{source.pagesVerified}</td><td>{source.demandAccepted}</td><td>{source.reviews}</td><td>{source.requests}</td><td>{source.usageCalls}</td><td>{source.inputTokens}</td><td>{source.outputTokens}</td><td>{source.webSearchRequests}</td><td>{source.webFetchRequests}</td>
                </tr>
              ))}</tbody>
            </table>
            {run.sources.filter((source) => source.drops.length > 0).map((source) => (
              <details key={`${source.name}-drops`}>
                <summary>{source.name}: {source.drops.length} afgewezen kandidaten</summary>
                <ul>{source.drops.map((drop, index) => (
                  <li key={index}>{drop.title} — {drop.stage} — {drop.reason}</li>
                ))}</ul>
              </details>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

export default async function SourceHealthPage() {
  const [{ requirePlatformAdmin }, { getSourceHealthRuns }, { getHotelScope }] =
    await Promise.all([
      import("@/lib/auth/require-account"),
      import("@/features/accounts/source-health"),
      import("@/features/workspace/hotel-context"),
    ]);
  const account = await requirePlatformAdmin();
  const scope = await getHotelScope(account.accountId);
  const runs = await getSourceHealthRuns();
  return (
    <main className="admin-page">
      <header className="page-title"><span className="eyebrow">Platformbeheer</span><h1>Bronstatus</h1><p>De laatste 100 verzamelruns met aantallen, fouten en API-verbruik.</p></header>
      <div className="admin-refresh">
        {scope.selectedHotelId && (
          <RefreshHotelForm hotelId={scope.selectedHotelId} />
        )}
        <RefreshAllForm />
      </div>
      <SourceHealthTable runs={runs} />
    </main>
  );
}

