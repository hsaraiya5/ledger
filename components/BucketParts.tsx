"use client";

import { Chart, tipRow } from "@/components/Chart";
import { cls, fmt, fmtK, sgn, ymLabel, type Account, type Snapshot } from "@/lib/ledger";

// Shared by the Retirement and Investments pages.
export const COLORS = ["var(--g1)", "var(--g5)", "var(--g4)", "var(--g7)", "var(--g6)", "var(--g14)"];
export const toggle = (set: Set<string>, id: string) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n; };
export const sgnUsd = (n: number) => (n >= 0 ? "+" : "−") + fmt(Math.abs(n));

export function AccountPills({ accounts, color, label, last, hidden, onToggle }: {
  accounts: Account[]; color: Record<string, string>; label: (a: Account) => string; last: Snapshot; hidden: Set<string>; onToggle: (id: string) => void;
}) {
  return (
    <div className="apills" role="group" aria-label="Accounts shown">
      {accounts.map((a) => (
        <button key={a.id} type="button" className="apill" aria-pressed={!hidden.has(a.id)} onClick={() => onToggle(a.id)}>
          <i style={{ background: color[a.id] }} />{label(a)}<span className="num">{fmtK(last.v[a.id] ?? 0)}</span>
        </button>
      ))}
    </div>
  );
}

/** Balances stacked by account, bottom to top in account order, starting just before the first month with money in it. */
export function StackedChart({ snaps, from, shown, color, label, name }: {
  snaps: Snapshot[]; from: number; shown: Account[]; color: Record<string, string>; label: (a: Account) => string; name: string;
}) {
  let inWin = snaps.filter((s) => s.ym >= from);
  const firstFunded = inWin.findIndex((s) => shown.some((a) => (s.v[a.id] ?? 0) > 0));
  if (firstFunded > 1) inWin = inWin.slice(firstFunded - 1);
  if (!shown.length || inWin.length < 2) return <p className="muted small">{shown.length ? "Not enough history for this period." : "Select an account above."}</p>;

  const tops: Record<string, [number, number][]> = {}, bots: Record<string, [number, number][]> = {};
  inWin.forEach((s) => {
    let cum = 0;
    for (const a of shown) {
      (bots[a.id] ??= []).push([s.ym, cum]);
      cum += s.v[a.id] ?? 0;
      (tops[a.id] ??= []).push([s.ym, cum]);
    }
  });
  const total = (s: Snapshot) => shown.reduce((t, a) => t + (s.v[a.id] ?? 0), 0);
  return (
    <Chart
      label={`${name} balance by account`}
      height={300}
      x0={inWin[0].ym}
      x1={inWin[inWin.length - 1].ym}
      max={Math.max(1, ...inWin.map(total))}
      layers={shown.map((a) => ({ kind: "band" as const, top: tops[a.id], bot: bots[a.id], color: color[a.id] }))}
      hoverXs={inWin.map((s) => s.ym)}
      tooltip={(x) => {
        const s = inWin.find((z) => z.ym === x)!;
        return `<div class="t">${ymLabel(x)}</div>` +
          shown.slice().reverse().map((a) => tipRow(label(a), fmt(s.v[a.id] ?? 0), color[a.id])).join("") +
          (shown.length > 1 ? tipRow("<b>Total</b>", fmt(total(s))) : "");
      }}
    />
  );
}

export function TickerLink({ ticker }: { ticker: string }) {
  return (
    <a className="tk" href={`https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}`} target="_blank" rel="noreferrer">{ticker}<span className="ext">↗</span></a>
  );
}

export function MonthlyHistory({ snaps, id }: { snaps: Snapshot[]; id: string }) {
  const history = snaps.filter((s) => s.v[id] !== undefined).reverse();
  return (
    <div className="panel s12">
      <div className="ph"><h2>Monthly history</h2><span className="muted small">{history.length} months</span></div>
      <div className="tbl-wrap">
        <table>
          <thead><tr><th>Month</th><th className="r">Balance</th><th className="r">Change</th></tr></thead>
          <tbody>
            {history.map((s, i) => {
              const prev = history[i + 1];
              const dv = prev ? (s.v[id] ?? 0) - (prev.v[id] ?? 0) : null;
              return (
                <tr key={s.ym}>
                  <td>{ymLabel(s.ym)}</td>
                  <td className="r num">{fmt(s.v[id] ?? 0, 2)}</td>
                  <td className={`r num ${dv === null ? "" : cls(dv)}`}>{dv === null ? "" : sgn(dv, (n) => fmt(n, 2))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
