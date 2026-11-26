import { EmptyState } from "@/components/EmptyState";
import { HomeView } from "@/components/HomeView";
import { getInvestments, getLedger, getRetirement, getSpending, getSyncStatus } from "@/lib/data";
import { idsIn } from "@/lib/ledger";

export default async function HomePage() {
  const ledger = await getLedger();
  if (!ledger.snaps.length) {
    return <EmptyState title="Welcome to Ledger" body="Connect your bank, cards and investment accounts, and your net worth, spending and investments fill in here. The first sync brings in up to two years of history." />;
  }
  const [ret, inv, spending, sync] = await Promise.all([
    getRetirement(idsIn(ledger.accounts, "retirement")),
    getInvestments(idsIn(ledger.accounts, "brokerage")),
    getSpending(),
    getSyncStatus(),
  ]);
  return <HomeView ledger={ledger} members={ledger.members} ret={ret} inv={inv} spending={spending} sync={sync} />;
}
