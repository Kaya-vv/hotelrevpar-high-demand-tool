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
        <h1>Hotels en regio&apos;s</h1>
        <p>Gebeurtenissen worden per hotel binnen de ingestelde vraagstraal beoordeeld.</p>
      </header>
      <PortfolioForm {...portfolio} />
    </div>
  );
}

