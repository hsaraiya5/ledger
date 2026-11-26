// Retirement calculations shared by the Retirement page and Home.
import type { Holding, Retirement } from "@/lib/data";
import type { Account, Snapshot } from "@/lib/ledger";

// IRS limits on what you put in yourself: 401(k) deferrals count across every 401(k); IRA contributions across every IRA.
export const LIMITS: Record<number, { k401: number; ira: number }> = { 2026: { k401: 24500, ira: 7500 } };
export const isIra = (a: Account) => /\bIRA\b/.test(a.name);

export type HoldingV = Holding & { unvested?: number; unvestedShares?: number };

/**
 * Shares your purchases add up to but the balance doesn't show yet. We assume that's employer match still vesting
 * and count it as vested, so the fund's value is every share bought.
 */
function withUnvested(holdings: Holding[], bought: Record<string, number> | undefined): HoldingV[] {
  return holdings.map((h) => {
    const b = h.ticker ? bought?.[h.ticker] : undefined;
    if (b === undefined || !h.quantity || b - h.quantity <= h.quantity * 0.005) return h;
    const price = h.value / h.quantity;
    return { ...h, quantity: b, value: b * price, unvested: (b - h.quantity) * price, unvestedShares: b - h.quantity };
  });
}

/** Holdings per retirement account, with unvested match counted; and the snapshots with today's balances to match. */
export function vested(accounts: Account[], ret: Retirement, snaps: Snapshot[]) {
  // Only where contributions are recorded from the start do transactions cover every share bought.
  const holdingsOf: Record<string, HoldingV[] | undefined> = Object.fromEntries(accounts.map((a) => {
    const h = ret.holdings[a.id];
    return [a.id, h && (ret.contrib[a.id] ? withUnvested(h, ret.sharesBought[a.id]) : h)];
  }));
  const unvested = (id: string) => (holdingsOf[id] ?? []).reduce((t, h) => t + (h.unvested ?? 0), 0);
  // Today's balances include that unvested match too; earlier months stay as reported.
  const adjusted = snaps.map((s, i) => i < snaps.length - 1 ? s
    : { ...s, v: Object.fromEntries(Object.entries(s.v).map(([id, v]) => [id, v + unvested(id)])) });
  return { holdingsOf, snaps: adjusted };
}

/** This calendar year's recorded contributions for one account, by who put the money in. */
export function contribYtd(ret: Retirement, id: string, year: number) {
  const t = { you: 0, employer: 0 };
  for (const [ym, c] of Object.entries(ret.contrib[id] ?? {})) if (Math.floor(+ym / 12) === year) { t.you += c.you; t.employer += c.employer; }
  return t;
}
