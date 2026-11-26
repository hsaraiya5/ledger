import { InvestmentsView } from "@/components/InvestmentsView";
import { getInvestments, getLedger } from "@/lib/data";
import { idsIn } from "@/lib/ledger";
import { getMonthlyPrices } from "@/lib/prices";
import { EmptyState } from "@/components/EmptyState";

export const metadata = { title: "Investments · Ledger" };

export default async function InvestmentsPage() {
  const ledger = await getLedger();
  if (!ledger.snaps.length || !idsIn(ledger.accounts, "brokerage").length) {
    return <EmptyState title="No investment accounts yet" body="Connect a brokerage or stock plan on Connections to see holdings, growth and stock comp here." />;
  }
  const inv = await getInvestments(idsIn(ledger.accounts, "brokerage"));
  const tickers = [...new Set(Object.values(inv.lots).flat().filter((l) => !l.cash && l.ticker).map((l) => l.ticker!))].sort();
  const prices = await getMonthlyPrices(tickers);
  return <InvestmentsView ledger={ledger} inv={inv} prices={prices} />;
}
