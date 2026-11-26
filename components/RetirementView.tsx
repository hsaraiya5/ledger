"use client";

import Link from "next/link";
import { Fragment, startTransition, useState } from "react";
import { setTaxTreatment } from "@/app/(app)/retirement/actions";
import { AccountPills, COLORS, MonthlyHistory, sgnUsd, StackedChart, TickerLink, toggle } from "@/components/BucketParts";
import { Chips } from "@/components/ui";
import type { Retirement } from "@/lib/data";
import { contribYtd, isIra, LIMITS, vested, type HoldingV } from "@/lib/retirement";
import type { Prices } from "@/lib/prices";
import { cls, fmt, fmtK, MS, pct, PERIODS, startSnap, TAX_KINDS, ymLabel, type Account, type Ledger, type Period } from "@/lib/ledger";

const label = (a: Account) => (a.name.includes(a.institution) ? a.name : `${a.institution} ${a.name}`);

/** tax_treatment "Roth + Trad" = your contributions go in as Roth, the employer's as traditional (the usual 401(k) setup). */
function taxOf(a: Account) {
  if (a.taxTreatment === "Roth") return { tag: "Roth", you: "Roth", employer: "Roth" };
  if (a.taxTreatment === "Roth + Trad") return { tag: "Roth + Trad", you: "Roth", employer: "Trad" };
  return { tag: "Traditional", you: "Trad", employer: "Trad" };
}
const TaxTag = ({ t }: { t: string }) => <span className={`tag tax ${t === "Roth" ? "roth" : ""}`}>{t}</span>;
const shares = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });

type Row = {
  h: HoldingV;
  /** What was invested over the window: value at its start plus what went in since (all-time: what you put in). */
  inv: number | null;
  start: number;
  you: number;
  employer: number;
  /** The fund's own total return over the window. */
  ret: number | null;
  heldSince: number | null;
};

function fundRows(a: Account, holdings: HoldingV[], ret: Retirement, prices: Prices, from: number, startValue: number, all: boolean): Row[] {
  const total = holdings.reduce((t, h) => t + h.value, 0);
  const contrib = ret.contrib[a.id];
  return holdings.map((h) => {
    const px = h.ticker ? prices[h.ticker] : undefined;
    const latest = px ? px[Math.max(...Object.keys(px).map(Number))] : undefined;
    const retFrom = (fromYm: number) => (px?.[fromYm] && latest ? latest / px[fromYm] - 1 : null);
    const fundRet = retFrom(from);
    const share = total ? h.value / total : 0;
    if (contrib) {
      // Contributions are recorded for this account, so the window's money in is known; split it across funds by value.
      let you = 0, employer = 0, first: number | null = null;
      for (const [ym, c] of Object.entries(contrib)) {
        first = first === null ? +ym : Math.min(first, +ym);
        if (+ym > from) { you += c.you; employer += c.employer; }
      }
      const start = startValue * share;
      // If you started buying after the window opened, the fund's return counts from the month before your first purchase.
      const bought = first !== null && first > from;
      return { h, inv: start + (you + employer) * share, start, you: you * share, employer: employer * share, ret: bought ? retFrom(first! - 1) : fundRet, heldSince: bought ? first : null };
    }
    // No contribution records: all-time uses cost basis; a window assumes no new money, so its start is today's value at the old price.
    if (all) return { h, inv: h.costBasis, start: 0, you: 0, employer: 0, ret: fundRet, heldSince: null };
    const start = fundRet === null ? null : h.value / (1 + fundRet);
    return { h, inv: start, start: start ?? 0, you: 0, employer: 0, ret: fundRet, heldSince: null };
  });
}

/** The Retirement page; with accountId, the same view narrowed to one account. */
export function RetirementView({ ledger, ret, prices, accountId }: { ledger: Ledger; ret: Retirement; prices: Prices; accountId?: string }) {
  const accounts = ledger.accounts.filter((a) => a.bucket === "retirement");
  const one = accountId ? accounts.find((a) => a.id === accountId) : undefined;
  const scope = one ? [one] : accounts;
  const { holdingsOf, snaps } = vested(accounts, ret, ledger.snaps);
  const [period, setPeriod] = useState<Period>("All");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const color = Object.fromEntries(accounts.map((a, i) => [a.id, COLORS[i % COLORS.length]]));
  const last = snaps[snaps.length - 1];
  const s0 = startSnap(snaps, period);
  const all = period === "All";
  const words = period === "YTD" ? "this year" : "since " + ymLabel(s0.ym);
  const shown = scope.filter((a) => !hidden.has(a.id));

  const groups = shown.map((a) => {
    const holdings = holdingsOf[a.id];
    return { a, rows: holdings ? fundRows(a, holdings, ret, prices, s0.ym, s0.v[a.id] ?? 0, all) : null };
  });
  const known = groups.flatMap((g) => g.rows ?? []).filter((r) => r.inv !== null);
  const T = { inv: known.reduce((t, r) => t + r.inv!, 0), v: known.reduce((t, r) => t + r.h.value, 0) };

  return (
    <>
    {one && <div className="crumbs"><Link href="/retirement">Retirement</Link><span className="sep">/</span><b>{label(one)}</b></div>}
    <div className="dash">
      <div className="panel s8">
        <div className="ph">
          {one ? (
            <label className="eyebrow">
              {one.institution} ·{" "}
              <select className="tax-pick" value={one.taxTreatment} title="Roth + Trad: your contributions are Roth, your employer's are traditional"
                onChange={(e) => startTransition(() => setTaxTreatment(one.id, e.target.value))}>
                {!(TAX_KINDS as readonly string[]).includes(one.taxTreatment) && <option value={one.taxTreatment}>{one.taxTreatment}</option>}
                {TAX_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>
          ) : <span className="eyebrow">Retirement · {accounts.length} accounts</span>}
          <Chips value={period} options={PERIODS} onChange={setPeriod} />
        </div>
        <div className="figure">{fmt(scope.reduce((t, a) => t + (last.v[a.id] ?? 0), 0))}</div>
        {!one && <AccountPills accounts={accounts} color={color} label={label} last={last} hidden={hidden} onToggle={(id) => setHidden(toggle(hidden, id))} />}
        <StackedChart snaps={snaps} from={s0.ym} shown={shown} color={color} label={label} name="Retirement" />

        <div className="ph"><h2>Funds</h2><span className="muted small">{all ? "Invested = what you put in" : `Invested = value at ${ymLabel(s0.ym)} + what went in since`}</span></div>
        <div className="funds">
          <div className="fgrid fhd"><span>Fund</span><span className="r">Invested</span><span className="r">Value now</span><span className="r">Growth</span></div>
          {groups.map(({ a, rows }) => {
            const tax = taxOf(a);
            return (
              <div key={a.id} className="fgroup" style={{ borderLeftColor: color[a.id] }}>
                <div className="gh"><Link href={`/retirement/${a.id}`}>{label(a)}</Link><TaxTag t={tax.tag} /></div>
                {!rows ? (
                  <p className="gwait">Funds show up once {a.institution} is linked on the Connections page.</p>
                ) : rows.map((r) => {
                  const k = `${a.id}-${r.h.ticker ?? r.h.name}`;
                  const canSplit = !!ret.contrib[a.id], isOpen = canSplit && open.has(k);
                  const added = r.you + r.employer;
                  const gain = r.inv === null ? null : r.h.value - r.inv;
                  return (
                    <Fragment key={k}>
                      <div className="fgrid frow">
                        <div>{r.h.ticker ? (
                          <TickerLink ticker={r.h.ticker} />
                        ) : <span className="tk">—</span>}<div className="fn">{r.h.name}</div></div>
                        <div className="r num">
                          {r.inv === null ? "—" : canSplit ? (
                            <button type="button" className="exp" aria-expanded={isOpen} onClick={() => setOpen(toggle(open, k))}>{fmt(r.inv)}<span className="car">▾</span></button>
                          ) : fmt(r.inv)}
                          {!all && added > 0 && <div className="fn">{r.start > 0 ? `${fmtK(r.start)} + ${fmtK(added)} added` : `all added ${words}`}</div>}
                        </div>
                        <div className="r num">{fmt(r.h.value)}<div className="fn">{Math.round((r.h.value / rows.reduce((t, x) => t + x.h.value, 0)) * 100)}% of account</div></div>
                        <div className="r">
                          <span className={`gr num ${gain === null ? "" : cls(gain)}`}>{gain === null ? "—" : sgnUsd(gain)}</span>
                          {r.ret !== null && <span className="held">fund {pct(r.ret)}{r.heldSince !== null ? ` since you bought in (${ymLabel(r.heldSince)})` : ""}</span>}
                        </div>
                      </div>
                      {isOpen && (
                        <>
                          <div className="fgrid fsub"><span>You <TaxTag t={tax.you === "Roth" ? "Roth" : "Trad"} /></span><span className="r num">{fmt(r.you)}</span></div>
                          <div className="fgrid fsub"><span>Employer <TaxTag t={tax.employer === "Roth" ? "Roth" : "Trad"} /></span><span className="r num">{fmt(r.employer)}</span></div>
                          {r.start > 0 && <div className="fgrid fsub"><span className="muted">Value at {ymLabel(s0.ym)}</span><span className="r num">{fmt(r.start)}</span></div>}
                        </>
                      )}
                      {r.h.unvested ? (
                        <p className="gap-note">
                          Includes {shares(r.h.unvestedShares!)} shares ({fmt(r.h.unvested)}) of employer match that {a.institution} doesn&apos;t count yet, assuming it vests.
                        </p>
                      ) : null}
                    </Fragment>
                  );
                })}
              </div>
            );
          })}
          {known.length > 1 && (
            <div className="fgrid ftot">
              <span>Total</span><span className="r num">{fmt(T.inv)}</span><span className="r num">{fmt(T.v)}</span>
              <span className={`r num ${cls(T.v - T.inv)}`}>{sgnUsd(T.v - T.inv)}</span>
            </div>
          )}
        </div>
      </div>

      <Contributions accounts={scope} everyAccount={accounts} color={color} ret={ret} year={Math.floor(last.ym / 12)} yearStart={startSnap(snaps, "YTD").v} />
      {one && <MonthlyHistory snaps={snaps} id={one.id} />}
    </div>
    </>
  );
}

/** Contributions for `accounts`; IRS limits count across `everyAccount`, since they apply to all your 401(k)s or IRAs together. */
function Contributions({ accounts, everyAccount, color, ret, year, yearStart }: { accounts: Account[]; everyAccount: Account[]; color: Record<string, string>; ret: Retirement; year: number; yearStart: Record<string, number> }) {
  const ytd = (a: Account) => contribYtd(ret, a.id, year);
  const per = accounts.map((a) => ({ a, linked: !!ret.holdings[a.id], ...ytd(a) }));
  const you = per.reduce((t, p) => t + p.you, 0), employer = per.reduce((t, p) => t + p.employer, 0);
  const months = MS.map((_, i) => {
    const ym = year * 12 + i;
    return accounts.reduce((t, a) => { const c = ret.contrib[a.id]?.[ym]; return { you: t.you + (c?.you ?? 0), employer: t.employer + (c?.employer ?? 0) }; }, { you: 0, employer: 0 });
  });
  const barMax = Math.max(1, ...months.map((m) => m.you + m.employer));
  const limit = LIMITS[year];
  const k401 = everyAccount.filter((a) => !isIra(a)).reduce((t, a) => t + ytd(a).you, 0);
  const ira = everyAccount.filter(isIra).reduce((t, a) => t + ytd(a).you, 0);
  const gaps = [
    ...per.filter((p) => !p.linked).map((p) => `${p.a.institution} isn't linked yet, so its contributions aren't counted.`),
    // Only a gap if the account already held money when the year began (a new account has nothing earlier to miss).
    ...per.filter((p) => p.linked && (yearStart[p.a.id] ?? 0) > 0 && ret.historyFrom[p.a.id] > `${year}-01-01`).map((p) =>
      `${p.a.institution} only reports activity since ${ymLabel(+ret.historyFrom[p.a.id].slice(0, 4) * 12 + +ret.historyFrom[p.a.id].slice(5, 7) - 1)}, so earlier ${year} contributions to the ${p.a.name} aren't counted.`),
  ];

  return (
    <div className="panel s4 sticky">
      <div className="ph"><h2>{year} contributions</h2><span className="muted small">Jan 1 – today</span></div>
      <div className="contrib-big">
        <div><div className="lbl"><i style={{ background: "var(--g5)" }} />You</div><div className="v num">{fmt(you)}</div></div>
        <div><div className="lbl"><i style={{ background: "var(--g14)" }} />Employer</div><div className="v num">{fmt(employer)}</div></div>
      </div>
      {you + employer > 0 && (
        <div>
          <div className="cbars">
            {months.map((m, i) => (
              <div key={i} className="col" title={`${MS[i]}: you ${fmt(m.you)} · employer ${fmt(m.employer)}`}>
                <span style={{ height: `${(m.you / barMax) * 100}%`, background: "var(--g5)" }} />
                <span style={{ height: `${(m.employer / barMax) * 100}%`, background: "var(--g14)" }} />
              </div>
            ))}
          </div>
          <div className="cbars-x">{MS.map((m, i) => <span key={i}>{m[0]}</span>)}</div>
        </div>
      )}
      {limit && (
        <>
          {accounts.some((a) => !isIra(a)) && <Meter name="Your 401(k) deferrals" note={`${year} limit, across every 401(k)`} v={k401} max={limit.k401} />}
          {accounts.some(isIra) && <Meter name="IRA" note={`${year} contributions allowed until Apr 15, ${year + 1}`} v={ira} max={limit.ira} />}
        </>
      )}
      {accounts.length > 1 && <div className="ledger">
        <div className="ln cols"><span>Account</span><span>You</span><span>Employer</span></div>
        {per.map((p) => (
          <div key={p.a.id} className="ln cols">
            <span><i className="dot" style={{ background: color[p.a.id] }} />{label(p.a)}</span>
            <span className={`num ${p.linked ? "" : "muted"}`}>{p.linked ? fmt(p.you) : "—"}</span>
            <span className={`num ${!p.linked || isIra(p.a) ? "muted" : ""}`}>{!p.linked ? "—" : isIra(p.a) ? "n/a" : fmt(p.employer)}</span>
          </div>
        ))}
      </div>}
      {gaps.length > 0 && <p className="small muted">{gaps.join(" ")}</p>}
    </div>
  );
}

function Meter({ name, note, v, max }: { name: string; note: string; v: number; max: number }) {
  const over = v - max;
  return (
    <div className="meter">
      <div className="row"><span>{name}</span><span className="num">{fmt(v)} / {fmt(max)}</span></div>
      <div className="track"><span style={{ width: `${Math.min(1, v / max) * 100}%` }} /></div>
      <div className="row small"><span className="muted">{note}</span>{over > 0 && <span className="tag warn">{fmt(over)} over · check</span>}</div>
    </div>
  );
}
