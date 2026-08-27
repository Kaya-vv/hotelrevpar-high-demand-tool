import type { SourceHealthRun } from "@/features/accounts/source-health";

export function SourceHealthTable({ runs }: { runs: SourceHealthRun[] }) {
  return (
    <div className="health-list">
      {runs.map((run) => (
        <details className="panel" key={run.id}>
          <summary><strong>{run.accountName}</strong><span>{run.areaName}</span><span>{new Date(run.startedAt).toLocaleString("nl-NL")}</span><span>{run.errorSummary ?? "Voltooid"}</span></summary>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Bron</th><th>Status</th><th>Laatste succes</th><th>Fout</th><th>Gevonden</th><th>Uniek</th><th>Duplicaten</th><th>Review</th><th>Requests</th><th>Input</th><th>Output</th><th>Search</th></tr></thead>
              <tbody>{run.sources.map((source) => (
                <tr key={source.name}>
                  <td>{source.name}</td><td>{source.state}</td><td>{source.lastSuccess ? new Date(source.lastSuccess).toLocaleString("nl-NL") : "Geen"}</td><td>{source.currentError ?? ""}</td>
                  <td>{source.found}</td><td>{source.unique}</td><td>{source.duplicates}</td><td>{source.reviews}</td><td>{source.requests}</td><td>{source.inputTokens}</td><td>{source.outputTokens}</td><td>{source.webSearchRequests}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </details>
      ))}
    </div>
  );
}

export default async function SourceHealthPage() {
  const [{ requirePlatformAdmin }, { getSourceHealthRuns }] = await Promise.all([
    import("@/lib/auth/require-account"),
    import("@/features/accounts/source-health"),
  ]);
  await requirePlatformAdmin();
  const runs = await getSourceHealthRuns();
  return (
    <main className="plain-page">
      <header className="page-title"><span className="eyebrow">Platformbeheer</span><h1>Bronstatus</h1><p>De laatste 100 verzamelruns met aantallen, fouten en API-verbruik.</p></header>
      <SourceHealthTable runs={runs} />
    </main>
  );
}

