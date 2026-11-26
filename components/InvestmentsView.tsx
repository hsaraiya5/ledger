"use client";

import Link from "next/link";
import { Fragment, useState, useTransition } from "react";
import { setManualCost } from "@/app/(app)/investments/actions";
import { AccountPills, COLORS, MonthlyHistory, sgnUsd, StackedChart, TickerLink, toggle } from "@/components/BucketParts";
import { Chips } from "@/components/ui";
import type { Investments, Lot, ShareEvent } from "@/lib/data";
import type { Prices } from "@/lib/prices";
import { cls, fmt, fmtK, pct, PERIODS, startSnap, ymFromDate, ymLabel, type Account, type Ledger, type Period } from "@/lib/ledger";

const shares = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 3 });
const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.01, b * 0.005);

type Row = {
  lot: Lot;
  /** Value at the window's start plus what came in since (all-time: what you paid); null when unknown. */
  inv: number | null;
  start: number;
  added: number;
  ret: number | null;
  heldSince: number | null;
};

/**
 * Invested over a window for one holding. Share history comes from the brokerage's transactions:
 * - complete (they add up to the shares held): we know when every share arrived;
 * - short (fewer than held): history starts after you bought, but what's there is right;
 * - over (more than held, e.g. award shares moved to another account unrecorded): only trust an event that brought
 *   exactly the shares you hold (like an ESPP purchase).
 */
function lotRow(lot: Lot, events: ShareEvent[] | undefined, px: Record<number, number> | undefined, from: number, all: boolean, lineStart: number): Row {
  const latestYm = px ? Math.max(...Object.keys(px).map(Number)) : 0;
  const pNow = px?.[latestYm];
  // Today's value at another month's price.
  const valueAt = (ym: number, qty: number) => (px?.[ym] && pNow ? (lot.value / lot.quantity) * qty * (px[ym] / pNow) : null);
  const retFrom = (ym: number) => (px?.[ym] && pNow ? pNow / px[ym] - 1 : null);
  const basis = lot.costBasis ?? (lot.manualCost !== null ? lot.manualCost * lot.quantity : null);

  let ev = events;
  const sum = (ev ?? []).reduce((t, e) => t + e.qty, 0);
  if (ev && sum > lot.quantity * 1.005) { const exact = ev.find((e) => close(e.qty, lot.quantity)); ev = exact ? [exact] : undefined; }
  const complete = !!ev && close(ev.reduce((t, e) => t + e.qty, 0), lot.quantity);
  const heldSince = complete ? ymFromDate(ev![0].date) : lineStart;
  const ret = heldSince > from ? retFrom(heldSince - 1) : retFrom(from);
  const row = { lot, ret, heldSince: all || heldSince > from ? heldSince : null };

  if (all || heldSince > from) return { ...row, inv: basis, start: 0, added: basis ?? 0 };
  const after = (ev ?? []).filter((e) => ymFromDate(e.date) > from);
  if (!after.length) { const start = valueAt(from, lot.quantity); return { ...row, inv: start, start: start ?? 0, added: 0 }; }
  if (!ev) return { ...row, inv: null, start: 0, added: 0 };
  const start = valueAt(from, lot.quantity - after.reduce((t, e) => t + e.qty, 0));
  const added = after.reduce((t, e) => t + (valueAt(ymFromDate(e.date), e.qty) ?? NaN), 0);
  return start === null || Number.isNaN(added) ? { ...row, inv: null, start: 0, added: 0 } : { ...row, inv: start + added, start, added };
}

/** The Investments page; with accountId, the same view narrowed to one account. */
export function InvestmentsView({ ledger, inv, prices, accountId }: { ledger: Ledger; inv: Investments; prices: Prices; accountId?: string }) {
  const { snaps } = ledger;
  const accounts = ledger.accounts.filter((a) => a.bucket === "brokerage");
  const one = accountId ? accounts.find((a) => a.id === accountId) : undefined;
  const scope = one ? [one] : accounts;
  const [period, setPeriod] = useState<Period>("All");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const color = Object.fromEntries(accounts.map((a, i) => [a.id, COLORS[i % COLORS.length]]));
  const label = (a: Account) => a.name;
  const last = snaps[snaps.length - 1];
  const s0 = startSnap(snaps, period);
  const all = period === "All";
  const words = period === "YTD" ? "this year" : "since " + ymLabel(s0.ym);
  const shown = scope.filter((a) => !hidden.has(a.id));
  const lineStart = (id: string) => snaps.find((s) => (s.v[id] ?? 0) > 0)?.ym ?? s0.ym;

  const groups = shown.map((a) => ({
    a,
    rows: inv.lots[a.id]?.map((lot) => lot.cash
      ? { lot, inv: lot.value, start: lot.value, added: 0, ret: null, heldSince: null }
      : lotRow(lot, inv.events[`${lot.leaf}|${lot.ticker}`], lot.ticker ? prices[lot.ticker] : undefined, s0.ym, all, lineStart(a.id))),
  }));
  const known = groups.flatMap((g) => g.rows ?? []).filter((r) => r.inv !== null);
  const T = { inv: known.reduce((t, r) => t + r.inv!, 0), v: known.reduce((t, r) => t + r.lot.value, 0) };
  const unknown = groups.some((g) => g.rows?.some((r) => r.inv === null));

  const save = (lot: Lot, raw: string) => {
    const v = raw.trim() === "" ? null : Number(raw.replace(/[$,]/g, ""));
    if (v !== null && !(v > 0)) return;
    startTransition(async () => { await setManualCost(lot.leaf, lot.ticker!, v); setEditing(null); });
  };

  return (
    <>
      {one && <div className="crumbs"><Link href="/investments">Investments</Link><span className="sep">/</span><b>{one.name}</b></div>}
      <div className="dash">
        <div className="panel s8">
          <div className="ph">
            <span className="eyebrow">{one ? one.institution : `Investments · ${accounts.length} accounts`}</span>
            <Chips value={period} options={PERIODS} onChange={setPeriod} />
          </div>
          <div className="figure">{fmt(scope.reduce((t, a) => t + (last.v[a.id] ?? 0), 0))}</div>
          {!one && <AccountPills accounts={accounts} color={color} label={label} last={last} hidden={hidden} onToggle={(id) => setHidden(toggle(hidden, id))} />}
          <StackedChart snaps={snaps} from={s0.ym} shown={shown} color={color} label={label} name="Investments" />

          <div className="ph"><h2>Holdings</h2><span className="muted small">{all ? "Invested = what you paid" : `Invested = value at ${ymLabel(s0.ym)} + what came in since`}</span></div>
          <div className="funds">
            <div className="fgrid fhd"><span>Holding</span><span className="r">Invested</span><span className="r">Value now</span><span className="r">Growth</span></div>
            {groups.map(({ a, rows }) => {
              const total = (rows ?? []).reduce((t, r) => t + r.lot.value, 0);
              return (
                <div key={a.id} className="fgroup" style={{ borderLeftColor: color[a.id] }}>
                  <div className="gh"><Link href={`/investments/${a.id}`}>{a.name}</Link><span className="muted small" style={{ fontWeight: 400 }}>{a.institution}</span></div>
                  {!rows ? (
                    <p className="gwait">Holdings show up once {a.institution} is linked on the Connections page.</p>
                  ) : rows.map((r) => {
                    const { lot } = r;
                    const k = `${lot.leaf}|${lot.ticker ?? lot.name}`;
                    const gain = r.inv === null || lot.cash ? null : lot.value - r.inv;
                    const canEdit = !lot.cash && !!lot.ticker && lot.costBasis === null;
                    const sub = lot.leafLabel ?? lot.name;
                    if (lot.cash) return (
                      <div key={k} className="fgrid frow">
                        <div className="fn" style={{ fontSize: 13, color: "var(--ink-2)" }}>{lot.leafLabel && /cash/i.test(lot.leafLabel) ? lot.leafLabel : "Cash"}</div>
                        <div className="r num">{fmt(lot.value)}</div>
                        <div className="r num">{fmt(lot.value)}<div className="fn">{Math.round((lot.value / total) * 100)}% of account</div></div>
                        <div className="r num muted">—</div>
                      </div>
                    );
                    return (
                      <Fragment key={k}>
                        <div className="fgrid frow">
                          <div>{lot.ticker ? <TickerLink ticker={lot.ticker} /> : <span className="tk">—</span>}<div className="fn">{sub}</div></div>
                          <div className="r num">
                            {canEdit && editing === k ? (
                              <form className="paid" onSubmit={(e) => { e.preventDefault(); save(lot, new FormData(e.currentTarget).get("p") as string); }}>
                                $<input name="p" inputMode="decimal" placeholder="per share" defaultValue={lot.manualCost ?? ""} autoFocus aria-label={`What you paid per ${lot.ticker} share`} />
                                <button disabled={pending}>Save</button>
                              </form>
                            ) : canEdit && lot.manualCost === null ? (
                              <button type="button" className="addp" onClick={() => setEditing(k)}>Add what you paid</button>
                            ) : r.inv === null ? "—" : canEdit ? (
                              <button type="button" className="exp" onClick={() => setEditing(k)} title="Edit what you paid">{fmt(r.inv)}<span className="car">✎</span></button>
                            ) : fmt(r.inv)}
                            {editing !== k && (
                              <div className="fn">
                                {canEdit && lot.manualCost !== null && (all || r.heldSince !== null) ? `${shares(lot.quantity)} × ${fmt(lot.manualCost, 2)}`
                                  : !all && r.added > 0 ? (r.start > 0 ? `${fmtK(r.start)} + ${fmtK(r.added)} added` : `all added ${words}`) : ""}
                              </div>
                            )}
                          </div>
                          <div className="r num">{fmt(lot.value)}<div className="fn">{Math.round((lot.value / total) * 100)}% of account</div></div>
                          <div className="r">
                            <span className={`gr num ${gain === null ? "" : cls(gain)}`}>{gain === null ? "—" : sgnUsd(gain)}</span>
                            {r.ret !== null && <span className="held">{pct(r.ret)}{r.heldSince !== null ? ` since ${ymLabel(r.heldSince)}` : ""}</span>}
                          </div>
                        </div>
                        {canEdit && lot.manualCost === null && editing !== k && (
                          <p className="gap-note">{a.institution} doesn&apos;t report what you paid for these. It&apos;s the purchase price on your confirmation.</p>
                        )}
                      </Fragment>
                    );
                  })}
                </div>
              );
            })}
            {known.length > 1 && (
              <div className="fgrid ftot">
                <span>Total{unknown && <span className="muted small" style={{ fontWeight: 400 }}> (where cost is known)</span>}</span>
                <span className="r num">{fmt(T.inv)}</span><span className="r num">{fmt(T.v)}</span>
                <span className={`r num ${cls(T.v - T.inv)}`}>{sgnUsd(T.v - T.inv)}</span>
              </div>
            )}
          </div>
        </div>

        <StockComp accounts={scope} inv={inv} prices={prices} year={Math.floor(last.ym / 12)} />
        {one && <MonthlyHistory snaps={snaps} id={one.id} />}
      </div>
    </>
  );
}

/**
 * This year's stock comp, read from the brokerages' transaction names: RSU vests ("restricted stock lapse"),
 * shares sold to cover their taxes (sales within a week of a vest), and ESPP purchases.
 */
function StockComp({ accounts, inv, prices, year }: { accounts: Account[]; inv: Investments; prices: Prices; year: number }) {
  const rows = accounts.flatMap((a) => {
    const leaves = new Set((inv.lots[a.id] ?? []).map((l) => l.leaf));
    const evs = Object.entries(inv.events).filter(([k]) => leaves.has(k.split("|")[0]))
      .flatMap(([k, es]) => es.map((e) => ({ ...e, leaf: k.split("|")[0], ticker: k.split("|")[1] })))
      .filter((e) => +e.date.slice(0, 4) === year);
    const vests = evs.filter((e) => /restricted stock lapse/i.test(e.name));
    const near = (e: { date: string }) => vests.some((v) => { const d = (Date.parse(e.date) - Date.parse(v.date)) / 864e5; return d >= 0 && d <= 7; });
    const sold = evs.filter((e) => e.type === "sell" && near(e));
    const espp = evs.filter((e) => /stock purchase|allocate shares/i.test(e.name));
    // A vest is worth the price its sell-to-cover got that week, else that month's price.
    const vestPrice = (v: (typeof vests)[number]) =>
      sold.find((s) => s.ticker === v.ticker && (Date.parse(s.date) - Date.parse(v.date)) / 864e5 <= 7 && s.date >= v.date)?.price
      ?? prices[v.ticker]?.[ymFromDate(v.date)] ?? 0;
    const cost = (e: (typeof espp)[number]) => (inv.lots[a.id] ?? []).find((l) => l.leaf === e.leaf && l.ticker === e.ticker)?.manualCost ?? null;
    const esppCosts = espp.map(cost);
    if (!vests.length && !espp.length) return [];
    return [{
      a,
      vested: vests.reduce((t, v) => t + v.qty, 0), vestValue: vests.reduce((t, v) => t + v.qty * vestPrice(v), 0), count: vests.length,
      sold: sold.reduce((t, s) => t - s.qty, 0), soldValue: sold.reduce((t, s) => t - s.amount, 0),
      espp: espp.reduce((t, e) => t + e.qty, 0), esppValue: esppCosts.every((c) => c !== null) ? espp.reduce((t, e, i) => t + e.qty * esppCosts[i]!, 0) : null,
      esppMonths: [...new Set(espp.map((e) => ymLabel(ymFromDate(e.date)).slice(0, 3)))].join(", "),
    }];
  });
  if (!rows.length) return null;
  return (
    <div className="panel s4 sticky">
      <div className="ph"><h2>{year} stock comp</h2><span className="muted small">Jan 1 – today</span></div>
      {rows.map((r) => (
        <div key={r.a.id} className="ledger">
          <div className="ln cols"><span>{r.a.name}</span><span>Shares</span><span>Value then</span></div>
          {r.count > 0 && <div className="ln cols"><span>RSUs vested <span className="muted small">· {r.count} vest{r.count > 1 ? "s" : ""}</span></span><span className="num">{shares(r.vested)}</span><span className="num">{fmt(r.vestValue)}</span></div>}
          {r.sold > 0 && <div className="ln cols"><span className="muted">Sold to cover taxes</span><span className="num muted">−{shares(r.sold)}</span><span className="num muted">−{fmt(r.soldValue)}</span></div>}
          {r.espp > 0 && <div className="ln cols"><span>ESPP purchase{r.esppMonths && <span className="muted small"> · {r.esppMonths}</span>}</span><span className="num">{shares(r.espp)}</span><span className={`num ${r.esppValue === null ? "muted" : ""}`}>{r.esppValue === null ? "—" : fmt(r.esppValue)}</span></div>}
        </div>
      ))}
      <p className="small muted">&ldquo;Value then&rdquo; is the share price on each vest day, and what you paid for ESPP shares once you&apos;ve added it.</p>
    </div>
  );
}
