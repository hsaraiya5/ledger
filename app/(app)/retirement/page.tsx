import { RetirementView } from "@/components/RetirementView";
import { getLedger, getRetirement } from "@/lib/data";
import { idsIn } from "@/lib/ledger";
import { getMonthlyPrices } from "@/lib/prices";
import { EmptyState } from "@/components/EmptyState";

export const metadata = { title: "Retirement · Ledger" };

export default async function RetirementPage() {
  const ledger = await getLedger();
  if (!ledger.snaps.length || !idsIn(ledger.accounts, "retirement").length) {
    return <EmptyState title="No retirement accounts yet" body="Connect your 401(k), IRA or other retirement accounts on Connections to see balances, funds and this year's contributions here." />;
  }
  const ret = await getRetirement(idsIn(ledger.accounts, "retirement"));
  const tickers = [...new Set(Object.values(ret.holdings).flat().map((h) => h.ticker).filter((t): t is string => !!t))].sort();
  const prices = await getMonthlyPrices(tickers);
  return <RetirementView ledger={ledger} ret={ret} prices={prices} />;
}
