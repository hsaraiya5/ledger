import { notFound } from "next/navigation";
import { RetirementView } from "@/components/RetirementView";
import { getLedger, getRetirement } from "@/lib/data";
import { idsIn } from "@/lib/ledger";
import { getMonthlyPrices } from "@/lib/prices";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ledger = await getLedger();
  const ids = idsIn(ledger.accounts, "retirement");
  if (!ids.includes(id)) notFound();
  // Every retirement account is loaded: IRS limits count across all of them.
  const ret = await getRetirement(ids);
  const tickers = [...new Set((ret.holdings[id] ?? []).map((h) => h.ticker).filter((t): t is string => !!t))].sort();
  const prices = await getMonthlyPrices(tickers);
  return <RetirementView ledger={ledger} ret={ret} prices={prices} accountId={id} />;
}
