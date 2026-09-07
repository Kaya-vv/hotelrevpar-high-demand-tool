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
              <thead><tr><th>Bron</th><th>Status</th><th>Laatste succes</th><th>Fout</th><th>Gevonden</th><th>Uniek</th><th>Duplicaten</th><th>Namen</th><th>Officiële URL&apos;s</th><th>Geverifieerd</th><th>Vraag beoordeeld</th><th>Review</th><th>Requests</th><th>AI-calls</th><th>Input</th><th>Output</th><th>Search</th><th>Fetch</th></tr></thead>
              <tbody>{run.sources.map((source) => (
                <tr key={source.name}>
                  <td>{source.name}</td><td>{!run.finishedAt && source.state === "not_run" ? "Wachten" : source.state}</td><td>{source.lastSuccess ? new Date(source.lastSuccess).toLocaleString("nl-NL") : "Geen"}</td><td>{source.currentError ?? ""}</td>
                  <td>{source.found}</td><td>{source.unique}</td><td>{source.duplicates}</td><td>{source.namesDiscovered}</td><td>{source.urlsResolved}</td><td>{source.pagesVerified}</td><td>{source.demandAccepted}</td><td>{source.reviews}</td><td>{source.requests}</td><td>{source.usageCalls}</td><td>{source.inputTokens}</td><td>{source.outputTokens}</td><td>{source.webSearchRequests}</td><td>{source.webFetchRequests}</td>
                </tr>
              ))}</tbody>
            </table>
            {run.sources.filter((source) => source.research?.longRange_newEditions !== undefined).map((source) => (
              <dl key={`${source.name}-research`} className="hotel-status-grid">
                {Object.entries({ Extractiefouten: "extractionFailures", Onbereikbare_bronnen: "unavailableSources", Binnen_14_dagen: "announcementWithin14Days", Later_dan_14_dagen: "announcementMissed14Days", Aankondigingsdatum_onbekend: "announcementDateUnknown", Gepubliceerd_voor_hotel: "hotelPublished", Nieuwe_edities: "newEditions", Hergebruikte_edities: "cachedEditions", Locatie_onbekend: "pendingLocation", Vraag_in_onderzoek: "pendingDemand", Geblokkeerde_bronnen: "blockedSources", Oudste_achterstand_dagen: "oldestOverdueDays", Maandkosten_EUR_schatting: "monthlySpentEur", Gereserveerd_EUR: "reservedEur" }).map(([label, key]) => (
                  <div key={key}><dt>{label.replaceAll("_", " ")}</dt><dd>{(source.research?.[`longRange_${key}`] ?? 0).toFixed(2)}</dd></div>
                ))}
              </dl>
            ))}
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
  const [{ requirePlatformAdmin }, { getSourceHealthRuns, getMarketResearchHealth }, { getHotelScope }] =
    await Promise.all([
      import("@/lib/auth/require-account"),
      import("@/features/accounts/source-health"),
      import("@/features/workspace/hotel-context"),
    ]);
  const account = await requirePlatformAdmin();
  const scope = await getHotelScope(account.accountId);
  const runs = await getSourceHealthRuns();
  const markets = await getMarketResearchHealth();
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
      {markets.length > 0 && <section className="panel">
        <h2>Onderzoek naar toekomstige evenementen</h2>
        <p>Gedeeld per stad en straal. Hotelverversingen wachten niet op dit onderzoek.</p>
        {markets.map((market) => <details key={market.key}>
          <summary>{market.city} ({market.radius} km): {!market.completedAt ? "Onderzoek loopt" : market.publicationPending ? "Publicatie in behandeling" : "Verwerkt"}</summary>
          <p>Aangevraagd: {new Date(market.requestedAt).toLocaleString("nl-NL")}. {market.completedAt && `Onderzoek afgerond: ${new Date(market.completedAt).toLocaleString("nl-NL")}.`} {market.publishedAt && `Kalenders bijgewerkt: ${new Date(market.publishedAt).toLocaleString("nl-NL")}.`}</p>
          <p>{market.leads} gecontroleerde leads; {market.waves} AI-rondes.</p>
          {market.error && <p>{market.error}</p>}
          <dl className="hotel-status-grid">{Object.entries({ Nieuwe_edities: "newEditions", Hergebruikte_edities: "cachedEditions", Locatie_onbekend: "pendingLocation", Vraag_in_onderzoek: "pendingDemand", Geblokkeerde_bronnen: "blockedSources", Oudste_achterstand_dagen: "oldestOverdueDays", Onderzoeksduur_seconden: "researchLatencySeconds", Hotelkalender_vermeldingen: "hotelPublished", Binnen_14_dagen: "announcementWithin14Days", Later_dan_14_dagen: "announcementMissed14Days", Aankondigingsdatum_onbekend: "announcementDateUnknown", Maandkosten_EUR_schatting: "monthlySpentEur", Gereserveerd_EUR: "reservedEur" }).map(([label, key]) => <div key={key}><dt>{label.replaceAll("_", " ")}</dt><dd>{market.usage?.[key]?.toFixed(2) ?? "Nog niet beschikbaar"}</dd></div>)}</dl>
        </details>)}
      </section>}
    </main>
  );
}

