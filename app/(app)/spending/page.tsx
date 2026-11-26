import { connection } from "next/server";
import { SpendingView } from "@/components/spending/SpendingView";
import { getSpending } from "@/lib/data";

export const metadata = { title: "Spending · Ledger" };

export default async function SpendingPage() {
  await connection();
  const data = await getSpending();
  // "Today" in Eastern time, so the month doesn't flip early in the evening.
  const todayIso = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  return <SpendingView data={data} todayIso={todayIso} />;
}
