import Link from "next/link";
import { SourceHealthList } from "@/features/accounts/source-health-list";
export { SourceHealthTable, runStatusLabel } from "@/features/accounts/source-health-table";
import { RefreshAllForm } from "@/features/collection/refresh-all-form";
import { RefreshHotelForm } from "@/features/collection/refresh-hotel-form";
import { RefreshRunStatus } from "@/features/collection/refresh-run-status";

export default async function SourceHealthPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const params = await searchParams;
  const page = /^\d{1,5}$/.test(params.page ?? "") ? Number(params.page) : 0;
  const [{ requirePlatformAdmin }, { getSourceHealthSummaries, getMarketResearchHealth }, { getHotelScope }] =
    await Promise.all([
      import("@/lib/auth/require-account"),
      import("@/features/accounts/source-health"),
      import("@/features/workspace/hotel-context"),
    ]);
  const account = await requirePlatformAdmin();
  const scope = await getHotelScope(account.accountId);
  const runs = await getSourceHealthSummaries(page);
  const markets = await getMarketResearchHealth();
  return (
    <main className="admin-page">
      <header className="page-title"><span className="eyebrow">Platformbeheer</span><h1>Bronstatus</h1><p>Verzamelruns met aantallen, fouten en API-verbruik, 20 per pagina. Open een run voor details en eerdere succesvolle broncontroles.</p></header>
      <div className="admin-refresh">
        {scope.selectedHotelId && (
          <RefreshHotelForm hotelId={scope.selectedHotelId} />
        )}
        <RefreshAllForm />
      </div>
      <SourceHealthList runs={runs} />
      <nav aria-label="Verzamelruns pagina's">
        {page > 0 && <Link href={`/admin/source-health?page=${page - 1}`} prefetch={false}>Nieuwere runs</Link>}{" "}
        {runs.length === 20 && <Link href={`/admin/source-health?page=${page + 1}`} prefetch={false}>Oudere runs</Link>}
      </nav>
      <RefreshRunStatus pending={runs.some((run) => !run.finishedAt || run.researchPending)} />
      {markets.length > 0 && <section className="panel">
        <h2>Onderzoek naar toekomstige evenementen</h2>
        <p>Gedeeld per stad en straal. Hotelverversingen wachten niet op dit onderzoek.</p>
        {markets.map((market) => <details key={market.key}>
          <summary>{market.city} ({market.radius} km): {!market.completedAt ? "Onderzoek loopt" : market.publicationPending ? "Publicatie in behandeling" : "Verwerkt"}</summary>
          <p>Aangevraagd: {new Date(market.requestedAt).toLocaleString("nl-NL")}. {market.completedAt && `Onderzoek afgerond: ${new Date(market.completedAt).toLocaleString("nl-NL")}.`} {market.publishedAt && `Kalenders bijgewerkt: ${new Date(market.publishedAt).toLocaleString("nl-NL")}.`}</p>
          <p>{market.leads} gecontroleerde leads; {market.waves} AI-rondes.</p>
          {market.error && <p>{market.error}</p>}
          <dl className="hotel-status-grid">{Object.entries({ Nieuwe_edities: "newEditions", Hergebruikte_edities: "cachedEditions", Locatie_onbekend: "pendingLocation", Vraag_in_onderzoek: "pendingDemand", Geblokkeerde_bronnen: "blockedSources", Oudste_achterstand_dagen: "oldestOverdueDays", Onderzoeksduur_seconden: "researchLatencySeconds", Hotelkalender_vermeldingen: "hotelPublished", Binnen_14_dagen: "announcementWithin14Days", Later_dan_14_dagen: "announcementMissed14Days", Aankondigingsdatum_onbekend: "announcementDateUnknown", Uitgesteld_budget: "budgetDeferred", Uitgesteld_cyclus: "cycleDeferred", Maandkosten_EUR_schatting: "monthlySpentEur", Gereserveerd_EUR: "reservedEur" }).map(([label, key]) => <div key={key}><dt>{label.replaceAll("_", " ")}</dt><dd>{market.usage?.[key]?.toFixed(2) ?? "Nog niet beschikbaar"}</dd></div>)}</dl>
        </details>)}
      </section>}
    </main>
  );
}

