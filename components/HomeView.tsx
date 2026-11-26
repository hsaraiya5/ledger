"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Chart, tipRow, type Layer } from "@/components/Chart";
import { Packed } from "@/components/Packed";
import { mine, sumBy, totals, type Ctx } from "@/components/spending/model";
import type { Investments, Member, Retirement, Spending, SyncStatus } from "@/lib/data";
import { BUCKETS, BUCKET_ORDER, fmt, fmtK, idsIn, MS, sumAt, ymFromDate, ymLabel, type Ledger } from "@/lib/ledger";
import { contribYtd, isIra, LIMITS, vested } from "@/lib/retirement";

const HOLD_COLORS = ["var(--g6)", "var(--g5)", "var(--g1)", "var(--g7)", "var(--g4)", "var(--g14)"];

/** A small trend, scaled to its own range so the shape shows. */
function MiniArea({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values) * 0.95, hi = Math.max(...values) * 1.02 || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${30 - ((v - lo) / (hi - lo || 1)) * 28}`).join(" ");
  return (
    <svg className="mini-area" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
      <polygon points={`0,30 ${pts} 100,30`} fill={color} fillOpacity={0.22} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Donut({ parts }: { parts: { v: number; color: string }[] }) {
  const R = 54, r = 34, c = 65, tot = parts.reduce((t, p) => t + p.v, 0) || 1;
  const pt = (rr: number, t: number) => `${c + rr * Math.cos(t)},${c + rr * Math.sin(t)}`;
  // Each slice starts where the ones before it end.
  const starts = parts.map((_, i) => -Math.PI / 2 + (parts.slice(0, i).reduce((t, p) => t + p.v, 0) / tot) * Math.PI * 2);
  return (
    <svg viewBox="0 0 130 130" width={130} height={130} aria-hidden="true">
      {parts.map((p, i) => {
        const a = starts[i], b = a + (p.v / tot) * Math.PI * 2, large = b - a > Math.PI ? 1 : 0, e = b - 0.02;
        const d = `M${pt(R, a)} A${R},${R} 0 ${large} 1 ${pt(R, e)} L${pt(r, e)} A${r},${r} 0 ${large} 0 ${pt(r, a)} Z`;
        return <path key={i} d={d} fill={p.color} />;
      })}
    </svg>
  );
}

/** "3h ago" style, worked out after load so server and browser agree. */
function Ago({ iso }: { iso: string | null }) {
  const [now, setNow] = useState<number | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- read the clock once after hydration
  useEffect(() => setNow(Date.now()), []);
  if (!iso) return <>never</>;
  if (now === null) return null;
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 6e4));
  return <>{m < 60 ? `${m}m ago` : m < 48 * 60 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`}</>;
}

export function HomeView({ ledger, members, ret, inv, spending, sync }: {
  ledger: Ledger; members: Record<string, Member[]>; ret: Retirement; inv: Investments; spending: Spending; sync: SyncStatus;
}) {
  const router = useRouter();
  const { accounts } = ledger;
  const retAccts = accounts.filter((a) => a.bucket === "retirement");
  const { snaps } = vested(retAccts, ret, ledger.snaps);
  const last = snaps[snaps.length - 1];
  const year = Math.floor(last.ym / 12);
  const all = accounts.map((a) => a.id);
  const total = (b: (typeof BUCKET_ORDER)[number], s = last) => sumAt(s, idsIn(accounts, b));

  // Net worth: buckets stacked, each band on the running total of the ones below it.
  const layers: Layer[] = BUCKET_ORDER.map((b, k) => {
    const below = BUCKET_ORDER.slice(0, k).flatMap((x) => idsIn(accounts, x));
    const withThis = [...below, ...idsIn(accounts, b)];
    return {
      kind: "band",
      bot: snaps.map((s): [number, number] => [s.ym, sumAt(s, below)]),
      top: snaps.map((s): [number, number] => [s.ym, sumAt(s, withThis)]),
      color: BUCKETS[b].color,
      href: b === "cash" ? undefined : BUCKETS[b].path,
    };
  });
  const recent = snaps.slice(-24);

  // Cash: every checking and savings account, except ones kept separate.
  const cashLeaves = accounts.filter((a) => a.bucket === "cash").flatMap((a) =>
    members[a.id]?.length
      ? members[a.id].map((m) => ({ label: m.nickname ?? m.name, full: m.name, balance: m.balance ?? 0, separate: m.separate }))
      : [{ label: a.nickname ?? a.name, full: a.name, balance: last.v[a.id] ?? 0, separate: false }]);
  const counted = cashLeaves.filter((l) => !l.separate);
  const savings = counted.filter((l) => /saving/i.test(l.full)), checking = counted.filter((l) => !/saving/i.test(l.full));
  const sum = (ls: { balance: number }[]) => ls.reduce((t, l) => t + l.balance, 0);
  const apart = cashLeaves.filter((l) => l.separate);

  // Retirement: this year's contributions and the 401(k) limit.
  const yt = retAccts.map((a) => ({ a, ...contribYtd(ret, a.id, year) }));
  const you = yt.reduce((t, x) => t + x.you, 0), employer = yt.reduce((t, x) => t + x.employer, 0);
  const k401 = yt.filter((x) => !isIra(x.a)).reduce((t, x) => t + x.you, 0), limit = LIMITS[year]?.k401;

  // Investments: what you hold across every account, cash pooled.
  const lots = Object.values(inv.lots).flat();
  const byTicker = new Map<string, number>();
  for (const l of lots) { const k = l.cash ? "Cash" : l.ticker ?? l.name; byTicker.set(k, (byTicker.get(k) ?? 0) + l.value); }
  const held = [...byTicker].sort((a, b) => (a[0] === "Cash" ? 1 : b[0] === "Cash" ? -1 : b[1] - a[1]))
    .map(([k, v], i) => ({ k, v, color: k === "Cash" ? "var(--g11)" : HOLD_COLORS[i % HOLD_COLORS.length] }));
  const invTotal = total("brokerage");
  const invIds = idsIn(accounts, "brokerage");
  const mover = lots.filter((l) => !l.cash)
    .map((l) => { const cost = l.costBasis ?? (l.manualCost !== null ? l.manualCost * l.quantity : null); return { l, gain: cost === null ? null : l.value - cost }; })
    .filter((x) => x.gain !== null).sort((a, b) => Math.abs(b.gain!) - Math.abs(a.gain!))[0];

  // Spending, counted the way the Spending page counts it.
  const ctx: Ctx = { splits: spending.splits, owed: spending.owed, acct: new Map(spending.accounts.map((a) => [a.id, a])), cats: new Map(spending.categories.map((c) => [c.name, c])) };
  const inMonth = (ym: number) => spending.txns.filter((t) => ymFromDate(t.date) === ym);
  const months = Array.from({ length: 6 }, (_, i) => last.ym - 5 + i).map((ym) => ({ ym, out: totals(ctx, inMonth(ym)).out }));
  const thisMonth = inMonth(last.ym);
  const topCats = sumBy(ctx, thisMonth, (p) => p.category).slice(0, 3);
  const barMax = Math.max(1, ...months.map((m) => m.out));

  // Biggest money in or out over the last 30 days.
  const newest = spending.txns.reduce((d, t) => (t.date > d ? t.date : d), "");
  const cutoff = new Date(Date.parse(newest) - 30 * 864e5).toISOString().slice(0, 10);
  const big = spending.txns.filter((t) => t.date >= cutoff && (t.kind === "spend" || t.kind === "income"))
    .map((t) => ({ t, m: mine(ctx, t) })).map((x) => ({ ...x, v: x.m.out || -x.m.in }))
    .filter((x) => x.v !== 0).sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, 5)
    .sort((a, b) => b.t.date.localeCompare(a.t.date));
  const acctLabel = (id: string) => ctx.acct.get(id)?.label ?? "";

  const cards = spending.accounts.filter((a) => a.bucket === "credit");
  const owedBy = new Map<string, { v: number; n: number }>();
  for (const os of Object.values(spending.owed)) for (const o of os) if (o.status === "waiting") {
    const e = owedBy.get(o.person) ?? { v: 0, n: 0 };
    owedBy.set(o.person, { v: e.v + o.amount, n: e.n + 1 });
  }
  const owed = [...owedBy].sort((a, b) => b[1].v - a[1].v);

  return (
    <Packed className="dash home">
      <div className="panel s8 hero">
        <div className="ph"><span className="eyebrow">Net worth · {ymLabel(last.ym)}</span></div>
        <div className="figure">{fmt(sumAt(last, all))}</div>
        <div className="wlegend">
          {BUCKET_ORDER.map((b) => (
            <Link key={b} href={b === "cash" ? "#cash" : BUCKETS[b].path}><i style={{ background: BUCKETS[b].color }} />{BUCKETS[b].name} <b className="num">{fmtK(total(b))}</b></Link>
          ))}
        </div>
        <Chart
          label="Net worth by bucket"
          height={260}
          x0={snaps[0].ym}
          x1={last.ym}
          max={Math.max(...snaps.map((s) => sumAt(s, all)))}
          layers={layers}
          onBandClick={(href) => router.push(href)}
          hoverXs={snaps.map((s) => s.ym)}
          tooltip={(x) => {
            const s = snaps.find((z) => z.ym === x)!;
            return `<div class="t">${ymLabel(x)}</div>` +
              [...BUCKET_ORDER].reverse().map((b) => tipRow(BUCKETS[b].name, fmt(total(b, s)), BUCKETS[b].color)).join("") +
              tipRow("<b>Total</b>", fmt(sumAt(s, all)));
          }}
        />
      </div>

      <Link className="panel s4 w" href="/spending" id="cash">
        <div className="ph"><h2>Cash</h2><span className="go">Statements →</span></div>
        <div className="wbig num">{fmt(sum(counted))}</div>
        <div className="split2">
          <div><div className="l">Checking</div><div className="v num">{fmtK(sum(checking))}</div><div className="s">{checking.map((l) => l.label).join(" · ")}</div></div>
          <div><div className="l">Savings</div><div className="v num">{fmtK(sum(savings))}</div><div className="s">{savings.map((l) => l.label).join(" · ")}</div></div>
        </div>
        <MiniArea values={recent.map((s) => total("cash", s))} color={BUCKETS.cash.color} />
        {apart.length > 0 && <p className="small muted">{apart.map((l) => `${l.label} (${fmt(l.balance)})`).join(", ")} kept separate and not counted.</p>}
      </Link>

      {retAccts.length > 0 && (
      <Link className="panel s4 w" href="/retirement">
        <div className="ph"><h2>Retirement</h2><span className="go">Open →</span></div>
        <div className="wbig num">{fmt(total("retirement"))}</div>
        <MiniArea values={recent.map((s) => total("retirement", s))} color={BUCKETS.retirement.color} />
        <div className="wlegend small">
          <span><i style={{ background: "var(--g5)" }} />You <b className="num">{fmt(you)}</b></span>
          <span><i style={{ background: "var(--g14)" }} />Employer <b className="num">{fmt(employer)}</b></span>
          <span className="muted">in {year}</span>
        </div>
        {limit && (
          <div>
            <div className="meter"><div className="track"><span style={{ width: `${Math.min(1, k401 / limit) * 100}%` }} /></div></div>
            <div className="small muted" style={{ marginTop: 4 }}>
              401(k) deferrals {fmt(k401)} of {fmt(limit)}{k401 > limit && <> · <span style={{ color: "var(--warn)" }}>{fmt(k401 - limit)} over</span></>}
            </div>
          </div>
        )}
      </Link>)}

      {invIds.length > 0 && (
      <Link className="panel s4 w" href="/investments">
        <div className="ph"><h2>Investments</h2><span className="go">Open →</span></div>
        <div className="wbig num">{fmt(invTotal)}</div>
        <div className="wdonut">
          <Donut parts={held.map((h) => ({ v: h.v, color: h.color }))} />
          <div className="lg">
            {held.map((h) => (
              <div key={h.k}><i style={{ background: h.color }} /><span>{h.k}</span><span className="num">{fmtK(h.v)}</span><span className="p num">{Math.round((h.v / (invTotal || 1)) * 100)}%</span></div>
            ))}
          </div>
        </div>
        {mover && (
          <p className="small">
            {mover.l.ticker}{mover.l.leafLabel ? ` · ${mover.l.leafLabel}` : ""}{" "}
            <b className={`num ${mover.gain! >= 0 ? "up" : "down"}`}>{mover.gain! >= 0 ? "+" : "−"}{fmt(Math.abs(mover.gain!))}</b> vs what you paid
          </p>
        )}
      </Link>)}

      <Link className="panel s4 w" href="/spending">
        <div className="ph"><h2>Spending</h2><span className="go">Open →</span></div>
        <div><div className="wbig num">{fmt(totals(ctx, thisMonth).out)}</div><div className="small muted">{MS[last.ym % 12]} so far</div></div>
        <div className="wbars">
          {months.map((m, i) => (
            <div key={m.ym} className="col">
              <span className="lbl num">{fmtK(m.out)}</span>
              <span className="bar" style={{ height: `${(m.out / barMax) * 100}%`, opacity: i === months.length - 1 ? 1 : 0.5 }} />
              <span className="x">{MS[m.ym % 12]}</span>
            </div>
          ))}
        </div>
        <div className="wrows">
          {topCats.map(([c, v]) => (
            <div key={c}><span>{c}{ctx.cats.get(c)?.isProject && <> <span className="tag">Project</span></>}</span><span className="num">{fmt(v)}</span></div>
          ))}
        </div>
      </Link>

      <Link className="panel s8 w" href="/spending">
        <div className="ph"><h2>Recent big transactions</h2><span className="go">Last 30 days →</span></div>
        <div className="wrows">
          {big.map(({ t, v }) => (
            <div key={t.id}>
              <span className="when num">{MS[+t.date.slice(5, 7) - 1]} {+t.date.slice(8)}</span>
              <span className="what"><b>{t.merchant}</b><span className="muted"> · {t.kind === "income" ? "Money in" : t.category ?? "Uncategorized"} · {acctLabel(t.accountId)}</span></span>
              <span className={`num ${v < 0 ? "up" : ""}`}>{v < 0 ? "+" : ""}{fmt(Math.abs(v))}</span>
            </div>
          ))}
        </div>
      </Link>

      <Link className="panel s4 w" href="/connections">
        <div className="ph"><h2>Sync</h2><span className="go">Connections →</span></div>
        <div className="wrows">
          {sync.items.map((i) => (
            <div key={i.institution}>
              <span><span className={`sdot ${i.status === "ok" ? "ok" : "bad"}`} />{i.institution}</span>
              <span className="muted small">{i.status === "ok" ? <Ago iso={i.syncedAt} /> : "Needs attention"}</span>
            </div>
          ))}
          {sync.unlinked.map((a) => (
            <div key={a.institution + a.name}><span><span className="sdot wait" />{a.institution} {a.name}</span><span className="muted small">Not linked</span></div>
          ))}
        </div>
      </Link>

      <Link className="panel s6 w" href="/spending">
        <div className="ph"><h2>Credit cards</h2><span className="go">Open →</span></div>
        <div className="wbig num">{fmt(cards.reduce((t, c) => t + (c.balance ?? 0), 0))}</div>
        <div className="wrows">
          {cards.map((c) => <div key={c.id}><span>{c.label}</span><span className="num">{c.balance === null ? "—" : fmt(c.balance)}</span></div>)}
        </div>
      </Link>

      <Link className="panel s6 w" href="/spending">
        <div className="ph"><h2>Owed to you</h2><span className="go">Open →</span></div>
        <div className="wbig num">{fmt(owed.reduce((t, [, o]) => t + o.v, 0))}</div>
        <div className="wrows">
          {owed.length ? owed.map(([p, o]) => <div key={p}><span>{p}{o.n > 1 && <span className="muted"> · {o.n} items</span>}</span><span className="num">{fmt(o.v)}</span></div>)
            : <div><span className="muted">Nobody owes you anything right now.</span></div>}
        </div>
      </Link>
    </Packed>
  );
}
