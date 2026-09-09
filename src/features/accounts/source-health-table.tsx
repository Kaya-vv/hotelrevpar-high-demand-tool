import type { SourceHealthRun } from "./source-health";

export function runStatusLabel(
  run: Pick<
    SourceHealthRun,
    "finishedAt" | "researchPending" | "errorSummary"
  > & { sources: { state: string }[] },
) {
  if (!run.finishedAt) return "Bezig";
  if (run.researchPending) return "Bezig: onderzoek en publicatie";
  if (run.errorSummary) return run.errorSummary;
  return run.sources.some((source) =>
    ["partial", "error", "failed", "unlicensed"].includes(source.state),
  )
    ? "Deels voltooid"
    : "Voltooid";
}

export function SourceHealthTable({ runs }: { runs: SourceHealthRun[] }) {
  return (
    <div className="health-list">
      {runs.map((run) => (
        <details className="panel" key={run.id}>
          <summary>
            <strong>{run.accountName}</strong>
            <span>{run.areaName}</span>
            <span>{new Date(run.startedAt).toLocaleString("nl-NL")}</span>
            <span>{runStatusLabel(run)}</span>
          </summary>
          <SourceHealthDetails run={run} />
        </details>
      ))}
    </div>
  );
}

export function SourceHealthDetails({ run }: { run: SourceHealthRun }) {
  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Bron</th>
              <th>Status</th>
              <th>Laatste succes</th>
              <th>Fout</th>
              <th>Gevonden</th>
              <th>Uniek</th>
              <th>Duplicaten</th>
              <th>Namen</th>
              <th>Officiële URL&apos;s</th>
              <th>Geverifieerd</th>
              <th>Vraag beoordeeld</th>
              <th>Review</th>
              <th>Requests</th>
              <th>AI-calls</th>
              <th>Input</th>
              <th>Output</th>
              <th>Search</th>
              <th>Fetch</th>
            </tr>
          </thead>
          <tbody>
            {run.sources.map((source) => (
              <tr key={source.name}>
                <td>{source.name}</td>
                <td>
                  {!run.finishedAt && source.state === "not_run"
                    ? "Wachten"
                    : source.state}
                </td>
                <td>
                  {source.lastSuccess
                    ? new Date(source.lastSuccess).toLocaleString("nl-NL")
                    : "Geen"}
                </td>
                <td>{source.currentError ?? ""}</td>
                <td>{source.found}</td>
                <td>{source.unique}</td>
                <td>{source.duplicates}</td>
                <td>{source.namesDiscovered}</td>
                <td>{source.urlsResolved}</td>
                <td>{source.pagesVerified}</td>
                <td>{source.demandAccepted}</td>
                <td>{source.reviews}</td>
                <td>{source.requests}</td>
                <td>{source.usageCalls}</td>
                <td>{source.inputTokens}</td>
                <td>{source.outputTokens}</td>
                <td>{source.webSearchRequests}</td>
                <td>{source.webFetchRequests}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {run.sources
          .filter(
            (source) => source.research?.longRange_newEditions !== undefined,
          )
          .map((source) => (
            <dl key={`${source.name}-research`} className="hotel-status-grid">
              {Object.entries({
                Extractiefouten: "extractionFailures",
                Onbereikbare_bronnen: "unavailableSources",
                Binnen_14_dagen: "announcementWithin14Days",
                Later_dan_14_dagen: "announcementMissed14Days",
                Aankondigingsdatum_onbekend: "announcementDateUnknown",
                Gepubliceerd_voor_hotel: "hotelPublished",
                Nieuwe_edities: "newEditions",
                Hergebruikte_edities: "cachedEditions",
                Locatie_onbekend: "pendingLocation",
                Vraag_in_onderzoek: "pendingDemand",
                Geblokkeerde_bronnen: "blockedSources",
                Oudste_achterstand_dagen: "oldestOverdueDays",
                Uitgesteld_budget: "budgetDeferred",
                Uitgesteld_cyclus: "cycleDeferred",
                Maandkosten_EUR_schatting: "monthlySpentEur",
                Gereserveerd_EUR: "reservedEur",
              }).map(([label, key]) => (
                <div key={key}>
                  <dt>{label.replaceAll("_", " ")}</dt>
                  <dd>
                    {(source.research?.[`longRange_${key}`] ?? 0).toFixed(2)}
                  </dd>
                </div>
              ))}
            </dl>
          ))}
        {run.sources
          .filter((source) => source.drops.length > 0)
          .map((source) => (
            <details key={`${source.name}-drops`}>
              <summary>
                {source.name}: {source.drops.length} afgewezen kandidaten
              </summary>
              <ul>
                {source.drops.map((drop, index) => (
                  <li key={index}>
                    {drop.title} — {drop.stage} — {drop.reason}
                  </li>
                ))}
              </ul>
            </details>
          ))}
      </div>
    </>
  );
}
