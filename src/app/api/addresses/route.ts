import { searchAddresses } from "@/features/portfolio/geocode";
import { requireAccount } from "@/lib/auth/require-account";

export async function GET(request: Request) {
  await requireAccount();

  try {
    const suggestions = await searchAddresses(new URL(request.url).searchParams.get("q") ?? "");
    return Response.json({ suggestions });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Adrescontrole is niet beschikbaar." },
      { status: 503 },
    );
  }
}
