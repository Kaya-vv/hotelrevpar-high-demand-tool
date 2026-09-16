import { getDashboardData } from "@/features/dashboard/query";
import { PortfolioForm } from "@/features/portfolio/portfolio-form";
import { getPortfolio } from "@/features/portfolio/queries";
import { requireAccount } from "@/lib/auth/require-account";
import { setHotelArchived } from "@/features/portfolio/actions";

export default async function PortfolioPage() {
  const { accountId, role } = await requireAccount();
  const [portfolio, insights, archived] = await Promise.all([
    getPortfolio(accountId),
    getDashboardData(accountId),
    getPortfolio(accountId, true),
  ]);

  return (
    <div>
      <div className="page-title-row">
        <header className="page-title">
          <span className="eyebrow">Portfolio</span>
          <h1>Hotels</h1>
          <p>
            Bekijk de status van je hotels, werk het portfolio bij en beheer de
            zoekinstellingen.
          </p>
        </header>
      </div>
      <PortfolioForm
        {...portfolio}
        insights={insights}
        isPlatformAdmin={role === "platform_admin"}
      />
      {archived.hotels.length > 0 && <details className="panel">
        <summary>Gearchiveerde hotels ({archived.hotels.length})</summary>
        <p>Deze hotels ontvangen geen zoekopdrachten of e-mails. Hun gegevens blijven bewaard.</p>
        {archived.hotels.map(hotel => <form key={hotel.id} action={setHotelArchived} className="hotel-card-actions">
          <strong>{hotel.name}</strong>
          <input type="hidden" name="hotelId" value={hotel.id} />
          <input type="hidden" name="archived" value="false" />
          <button className="secondary" type="submit">Herstellen</button>
        </form>)}
      </details>}
    </div>
  );
}
