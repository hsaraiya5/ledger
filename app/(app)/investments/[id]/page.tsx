import { notFound } from "next/navigation";
import { InvestmentsView } from "@/components/InvestmentsView";
import { getInvestments, getLedger } from "@/lib/data";
import { idsIn } from "@/lib/ledger";
import { getMonthlyPrices } from "@/lib/prices";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ledger = await getLedger();
  if (!idsIn(ledger.accounts, "brokerage").includes(id)) notFound();
  const inv = await getInvestments([id]);
  const tickers = [...new Set((inv.lots[id] ?? []).filter((l) => !l.cash && l.ticker).map((l) => l.ticker!))].sort();
  const prices = await getMonthlyPrices(tickers);
  return <InvestmentsView ledger={ledger} inv={inv} prices={prices} accountId={id} />;
}
