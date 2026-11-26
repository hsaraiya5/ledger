// Pure calculations for the Spending page. Amounts follow Plaid: positive = money out, negative = money in.
import type { Cat } from "@/lib/categories";
import type { Owe, Spending, SpendAccount, Split, Txn } from "@/lib/data";
import { ymFromDate } from "@/lib/ledger";

export type Ctx = Pick<Spending, "splits" | "owed"> & { acct: Map<string, SpendAccount>; cats: Map<string, Cat> };

export const isOut = (t: Txn) => t.kind === "spend";
export const separate = (c: Ctx, t: Txn) => !!c.acct.get(t.accountId)?.separate;

const owedSum = (os: Owe[] | undefined, keep: (o: Owe) => boolean) => (os ?? []).filter(keep).reduce((s, o) => s + o.amount, 0);
export const owedTotal = (c: Ctx, id: string) => owedSum(c.owed[id], () => true);
export const outstanding = (c: Ctx, id: string) => owedSum(c.owed[id], (o) => o.status === "waiting");

/**
 * What counts for you. Spending: your share (others' parts don't count unless they're not coming back).
 * Money in: nothing for paybacks. Transfers and kept-separate accounts: nothing.
 */
export function mine(c: Ctx, t: Txn): { out: number; in: number } {
  if (separate(c, t) || t.kind === "transfer" || t.kind === null) return { out: 0, in: 0 };
  if (t.kind === "income") return { out: 0, in: t.payback ? 0 : -t.amount };
  return { out: t.amount - owedSum(c.owed[t.id], (o) => o.status !== "gone"), in: 0 };
}

/** Your share of a purchase spread over its categories; split parts are scaled by your share. */
export function parts(c: Ctx, t: Txn): { category: string; sub: string | null; v: number }[] {
  if (!isOut(t) || separate(c, t)) return [];
  const v = mine(c, t).out;
  const sp: Split[] | undefined = c.splits[t.id];
  if (sp?.length) return sp.map((p) => ({ category: p.category, sub: p.sub, v: t.amount ? (p.amount / t.amount) * v : 0 }));
  return [{ category: t.category ?? "Other", sub: t.sub, v }];
}

export function totals(c: Ctx, list: Txn[]) {
  let out = 0, inn = 0;
  for (const t of list) { const m = mine(c, t); out += m.out; inn += m.in; }
  return { out, in: inn };
}

export function sumBy(c: Ctx, list: Txn[], key: (p: { category: string; sub: string | null }) => string, keep: (p: { category: string; sub: string | null }) => boolean = () => true) {
  const m = new Map<string, number>();
  for (const t of list) for (const p of parts(c, t)) if (keep(p)) m.set(key(p), (m.get(key(p)) ?? 0) + p.v);
  return [...m].filter((e) => Math.abs(e[1]) > 0.005).sort((a, b) => b[1] - a[1]);
}

export const inCategory = (c: Ctx, t: Txn, cat: string, sub: string) =>
  parts(c, t).some((p) => p.category === cat && (!sub || (p.sub ?? "") === sub));

export const color = (c: Ctx, cat: string | null) => `var(--${c.cats.get(cat ?? "")?.color ?? "g11"})`;

/** Months (ym) in the range ending at `end`. */
export const rangeYms = (end: number, months: number) => Array.from({ length: months }, (_, i) => end - months + 1 + i);
export const inRange = (t: Txn, yms: number[]) => yms.includes(ymFromDate(t.date));

export const money = (n: number, d = 2) => "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
export const pctOf = (v: number, total: number) => {
  const p = (v / (total || 1)) * 100;
  return p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`;
};
