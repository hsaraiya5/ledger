import "server-only";
import { cacheLife } from "next/cache";
import { demoPrices } from "@/lib/demo/db";
import { DEMO } from "@/lib/demo/mode";
import { ymFromDate } from "@/lib/ledger";

/** Month-end total-return prices (dividends reinvested) per ticker, keyed by ym. The current month holds the latest price. */
export type Prices = Record<string, Record<number, number>>;

export async function getMonthlyPrices(tickers: string[]): Promise<Prices> {
  return DEMO ? demoPrices(tickers) : yahooPrices(tickers);
}

async function yahooPrices(tickers: string[]): Promise<Prices> {
  "use cache";
  cacheLife("hours");
  const out: Prices = {};
  await Promise.all(tickers.map(async (t) => {
    try {
      // Yahoo Finance's public chart endpoint; monthly bars are stamped at the start of each month.
      const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?range=10y&interval=1mo`, {
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      if (!res.ok) return;
      const r = (await res.json())?.chart?.result?.[0];
      const ts: number[] = r?.timestamp ?? [];
      const adj: (number | null)[] = r?.indicators?.adjclose?.[0]?.adjclose ?? [];
      const m: Record<number, number> = {};
      ts.forEach((s, i) => { if (adj[i]) m[ymFromDate(new Date(s * 1000).toISOString())] = adj[i]!; });
      if (Object.keys(m).length) out[t] = m;
    } catch {
      // No history for this fund: its growth shows as unknown.
    }
  }));
  return out;
}
