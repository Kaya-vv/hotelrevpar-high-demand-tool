import { getDashboardData } from "@/features/dashboard/query";
import { PortfolioForm } from "@/features/portfolio/portfolio-form";
import { getPortfolio } from "@/features/portfolio/queries";
import { requireAccount } from "@/lib/auth/require-account";

export default async function PortfolioPage() {
  const { accountId, role } = await requireAccount();
  const [portfolio, insights] = await Promise.all([
    getPortfolio(accountId),
    getDashboardData(accountId),
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
    </div>
  );
}
