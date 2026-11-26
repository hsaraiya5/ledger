// Shared types and calculations. Months are stored as "ym" = year * 12 + monthIndex for easy arithmetic.

export type Bucket = "retirement" | "brokerage" | "cash";

export type Account = {
  id: string;
  name: string;
  institution: string;
  bucket: Bucket;
  taxTreatment: string;
  /** Your short name for it (set on Connections). */
  nickname: string | null;
  dataSource: "plaid" | "statement" | "manual";
};

export type Snapshot = { ym: number; v: Record<string, number> };

export type Ledger = { accounts: Account[]; snaps: Snapshot[] };

/** Choices for a retirement account's tax treatment. "Roth + Trad" = your contributions are Roth, the employer's traditional. */
export const TAX_KINDS = ["Roth", "Traditional", "Roth + Trad"] as const;

export const BUCKETS: Record<Bucket, { name: string; color: string; path: string }> = {
  retirement: { name: "Retirement", color: "var(--s-ret)", path: "/retirement" },
  brokerage: { name: "Investments", color: "var(--s-brk)", path: "/investments" },
  cash: { name: "Cash", color: "var(--s-cash)", path: "/" },
};
export const BUCKET_ORDER: Bucket[] = ["retirement", "brokerage", "cash"];

export const MS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const ymLabel = (ym: number) => `${MS[ym % 12]} ${Math.floor(ym / 12)}`;
export const ymFromDate = (iso: string) => +iso.slice(0, 4) * 12 + +iso.slice(5, 7) - 1;

export const fmt = (n: number, d = 0) =>
  (n < 0 ? "−" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
export const fmtK = (n: number) =>
  Math.abs(n) >= 1000
    ? (n < 0 ? "−" : "") + "$" + (Math.abs(n) / 1000).toFixed(Math.abs(n) >= 100000 ? 0 : 1).replace(/\.0$/, "") + "k"
    : fmt(n);
export const sgn = (n: number, f: (n: number) => string = fmt) => (n >= 0 ? "+" : "") + f(n);
export const pct = (n: number) => (n >= 0 ? "+" : "−") + Math.abs(n * 100).toFixed(1) + "%";
export const cls = (n: number) => (n >= 0 ? "up" : "down");

export const sumAt = (s: Snapshot, ids: string[]) => ids.reduce((t, id) => t + (s.v[id] ?? 0), 0);
export const idsIn = (accounts: Account[], b: Bucket) => accounts.filter((a) => a.bucket === b).map((a) => a.id);

export type Period = "1M" | "6M" | "YTD" | "1Y" | "3Y" | "All";
export const PERIODS: Period[] = ["1M", "6M", "YTD", "1Y", "3Y", "All"];
const PERIOD_MONTHS: Record<Exclude<Period, "YTD" | "All">, number> = { "1M": 1, "6M": 6, "1Y": 12, "3Y": 36 };

/** The latest snapshot at or before the period's start. */
export function startSnap(snaps: Snapshot[], p: Period): Snapshot {
  const last = snaps[snaps.length - 1];
  if (p === "All") return snaps[0];
  const target = p === "YTD" ? Math.floor(last.ym / 12) * 12 - 1 : last.ym - PERIOD_MONTHS[p];
  let s = snaps[0];
  for (const x of snaps) if (x.ym <= target) s = x;
  return s;
}

