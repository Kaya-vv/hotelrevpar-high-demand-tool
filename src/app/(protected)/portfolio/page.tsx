import { PortfolioForm } from "@/features/portfolio/portfolio-form";
import { getPortfolio } from "@/features/portfolio/queries";
import { requireAccount } from "@/lib/auth/require-account";

export default async function PortfolioPage() {
  const { accountId } = await requireAccount();
  const portfolio = await getPortfolio(accountId);

  return (
    <div>
      <header className="page-title">
        <span className="eyebrow">Instellingen</span>
        <h1>Hotels</h1>
        <p>Vul het hoteladres in. De app bepaalt de locatie en verzamelt gebeurtenissen binnen de ingestelde vraagstraal.</p>
      </header>
      <PortfolioForm {...portfolio} />
    </div>
  );
}

