"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { setOwedStatus } from "@/app/(app)/spending/actions";
import type { SpendAccount, Spending, Txn } from "@/lib/data";
import { MS, ymFromDate } from "@/lib/ledger";
import { Breakdown } from "./Breakdown";
import { color, inCategory, inRange, mine, money, outstanding, rangeYms, separate, sumBy, totals, type Ctx } from "./model";
import { TxnEditor } from "./TxnEditor";

export type Run = (fn: () => Promise<unknown>) => void;
export type Notify = (msg: string, undo?: () => Promise<unknown>) => void;
type Flow = "all" | "out" | "in" | "xfer";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const day = (iso: string) => `${MS[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}`;

export function SpendingView({ data, todayIso }: { data: Spending; todayIso: string }) {
  const { txns, olderOwed, accounts, categories, splits, owed } = data;
  const thisYm = ymFromDate(todayIso);
  const firstYm = txns.length ? ymFromDate(txns[txns.length - 1].date) : thisYm;

  const [endYm, setEndYm] = useState(thisYm);
  const [months, setMonths] = useState(1);
  const [acct, setAcct] = useState("");
  const [flow, setFlow] = useState<Flow>("all");
  const [cat, setCat] = useState("");
  const [sub, setSub] = useState("");
  const [q, setQ] = useState("");
  const [review, setReview] = useState(false);
  const [open, setOpen] = useState("");
  const [drawer, setDrawer] = useState<"" | "breakdown" | "owed">("");
  const [manage, setManage] = useState(false);
  const [withProjects, setWithProjects] = useState(true);
  const [toast, setToast] = useState<{ msg: string; undo?: () => Promise<unknown> } | null>(null);
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const notify: Notify = (msg, undo) => {
    setToast({ msg, undo });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 8000);
  };
  const run: Run = (fn) => startTransition(async () => {
    try { await fn(); } catch (e) { notify(e instanceof Error ? e.message : "That didn’t save. Try again."); }
  });
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!drawer) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector(".pop")) { setDrawer(""); setManage(false); } };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [drawer]);

  const ctx: Ctx = useMemo(() => ({
    splits, owed, acct: new Map(accounts.map((a) => [a.id, a])), cats: new Map(categories.map((c) => [c.name, c])),
  }), [splits, owed, accounts, categories]);
  const byId = useMemo(() => new Map([...txns, ...olderOwed].map((t) => [t.id, t])), [txns, olderOwed]);
  const owedPeople = owedGroups(ctx, byId);
  const owedSum = owedPeople.reduce((s, g) => s + g.total, 0);

  const yms = rangeYms(endYm, months);
  const rtx = txns.filter((t) => inRange(t, yms));
  const scoped = rtx.filter((t) => !acct || t.accountId === acct);
  const a = acct ? ctx.acct.get(acct) : undefined;
  const st = totals(ctx, scoped);
  const query = q.toLowerCase();
  const needsLook = txns.filter((t) => t.needsReview || t.kind === null);

  // "Needs a look" gathers every loaded month, since those rows are often older than the range.
  const list = (review ? txns.filter((t) => !acct || t.accountId === acct) : scoped).filter((t) =>
    // In All accounts a move between your accounts shows once, as its outgoing half.
    !(t.kind === "transfer" && t.amount < 0 && t.pairId && !acct) &&
    (flow === "all" || (flow === "xfer" ? t.kind === "transfer" : t.kind !== "transfer" && (flow === "out" ? t.amount > 0 : t.amount < 0))) &&
    (!cat || inCategory(ctx, t, cat, sub)) &&
    (!review || t.needsReview || t.kind === null) &&
    (!query || `${t.merchant} ${t.name} ${t.note ?? ""} ${t.category ?? ""} ${t.sub ?? ""}`.toLowerCase().includes(query)));

  // Running balance for a single bank account, worked backward from its latest balance.
  let balances: Map<string, number> | null = null;
  if (a && a.bucket !== "credit" && a.balance !== null) {
    balances = new Map();
    let b = a.balance;
    for (const t of txns.filter((x) => x.accountId === a.id && ymFromDate(x.date) > endYm)) b += t.amount;
    for (const t of rtx.filter((x) => x.accountId === a.id)) { balances.set(t.id, b); b += t.amount; }
  }

  const rangeLabel = months === 1
    ? `${MONTH_NAMES[endYm % 12]} ${Math.floor(endYm / 12)}`
    : `${MS[yms[0] % 12]}${Math.floor(yms[0] / 12) !== Math.floor(endYm / 12) ? ` ${Math.floor(yms[0] / 12)}` : ""} – ${MS[endYm % 12]} ${Math.floor(endYm / 12)}`;
  const shortRange = months === 1 ? `in ${MS[endYm % 12]}` : rangeLabel;
  const ncol = 4 + (acct ? 0 : 1) + (balances ? 1 : 0);
  const filter = (c: string, s: string) => { setCat(c); setSub(s); };

  const goto = (t: Txn) => {
    setEndYm(ymFromDate(t.date)); setMonths(1); setAcct(""); setFlow("all"); setCat(""); setSub(""); setQ(""); setReview(false); setOpen(t.id);
  };

  return (
    <>
      <div className="toolbar">
        <div className="month">
          <button type="button" className="ibtn" aria-label="Previous month" disabled={endYm - months + 1 <= firstYm} onClick={() => setEndYm(endYm - 1)}>‹</button>
          <div>
            <h1>{rangeLabel}</h1>
            {months === 1 && endYm === thisYm && <span className="small muted">Through {day(todayIso)}</span>}
          </div>
          <button type="button" className="ibtn" aria-label="Next month" disabled={endYm >= thisYm} onClick={() => setEndYm(endYm + 1)}>›</button>
        </div>
        <div className="seg" role="group" aria-label="Time range">
          {([[1, "Month"], [3, "3 months"], [12, "Year"]] as const).map(([v, l]) => (
            <button key={v} type="button" aria-pressed={months === v} onClick={() => setMonths(v)}>{l}</button>
          ))}
        </div>
        <button type="button" className={`btn owedbtn ${owedPeople.length ? "has" : ""}`} aria-pressed={drawer === "owed"}
          onClick={() => setDrawer(drawer === "owed" ? "" : "owed")}>
          <span>Owed<span className="wide-only"> to you</span></span>
          {owedPeople.length > 0 && <span className="badge num">{money(owedSum, 0)} · {owedPeople.length}</span>}
        </button>
        <button type="button" className="btn bdbtn" aria-pressed={drawer === "breakdown"} onClick={() => { setDrawer(drawer === "breakdown" ? "" : "breakdown"); setManage(false); }}>
          <MiniPie ctx={ctx} list={scoped} />Breakdown
        </button>
      </div>

      <div className="dash">
        <nav className="s12 acct-tabs" aria-label="Account">
          <Tab label="All accounts" active={!acct} onClick={() => setAcct("")} sub={spentLabel(totals(ctx, rtx).out)} />
          {accounts.map((x, i) => (
            <Fragment key={x.id}>
              {i === 0 || group(accounts[i - 1]) !== group(x) ? <span className="tab-gap" aria-hidden="true" /> : null}
              <Tab label={x.label} active={acct === x.id} onClick={() => setAcct(acct === x.id ? "" : x.id)}
                sub={x.separate ? (x.balance === null ? "kept separate" : `${money(x.balance, 0)} · separate`) : spentLabel(totals(ctx, rtx.filter((t) => t.accountId === x.id)).out)} />
            </Fragment>
          ))}
        </nav>

        <div className="panel s12">
          <div className="ph">
            <div><h2>{a ? a.fullName : "All accounts"}</h2>{!a && <span className="small muted">Checking, cards and Venmo together</span>}</div>
            {a?.separate ? (
              <span className="sums"><span><small>Balance</small>{a.balance === null ? "—" : money(a.balance)}</span></span>
            ) : (
              <span className="sums"><span><small>Out</small>{money(st.out)}</span><span className="in"><small>In</small>{money(st.in)}</span></span>
            )}
            {a?.separate && <p className="small muted" style={{ flexBasis: "100%" }}>Kept separate. Nothing in this account counts as spending or money in, including transfers into it. Change this on the Connections page.</p>}
          </div>
          <div className="filters">
            <div className="seg" role="group" aria-label="Direction">
              {([["all", "All"], ["out", "Money out"], ["in", "Money in"], ["xfer", "Transfers"]] as const).map(([v, l]) => (
                <button key={v} type="button" aria-pressed={flow === v} onClick={() => setFlow(v)}>{l}</button>
              ))}
            </div>
            <input type="search" id="txQ" placeholder="Search, incl. notes" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search transactions" />
            {(needsLook.length > 0 || review) && (
              <button type="button" className={`cchip rv chipbtn`} aria-pressed={review} onClick={() => setReview(!review)}>
                {review ? `Showing ${needsLook.length} to look at, all months · show all` : `Needs a look · ${needsLook.length}`}
              </button>
            )}
            {cat && <span className="chip">{sub ? `${cat} › ${sub}` : cat}<button type="button" aria-label="Clear category filter" onClick={() => filter("", "")}>×</button></span>}
            {pending && <span className="small muted">Saving…</span>}
          </div>
          <div className="tbl-wrap">
            <table className="txns">
              <thead><tr><th>Date</th><th>Description</th><th>Category</th>{!acct && <th>Account</th>}<th className="r">Amount</th>{balances && <th className="r">Balance</th>}</tr></thead>
              <tbody>
                {list.map((t) => (
                  <Row key={t.id} t={t} ctx={ctx} acct={acct} byId={byId} open={open === t.id} ncol={ncol} balance={balances?.get(t.id)}
                    onOpen={() => setOpen(open === t.id ? "" : t.id)} run={run} notify={notify} />
                ))}
              </tbody>
            </table>
            {!list.length && <p className="muted small empty">Nothing matches these filters.</p>}
          </div>
          <p className="small muted">
            Click a description to change its category, split it, add a note, or mark it as paid for other people.
            Card payments and transfers between your accounts are listed in grey and never counted.
          </p>
        </div>

      </div>

      {drawer === "owed" && (
        <OwedDrawer groups={owedPeople} total={owedSum} todayIso={todayIso} run={run} notify={notify}
          goto={(t) => { goto(t); setDrawer(""); }} onClose={() => setDrawer("")} />
      )}
      {drawer === "breakdown" && (
        <Breakdown ctx={ctx} scoped={scoped} all={txns} months={months} rangeLabel={shortRange} cat={cat} sub={sub}
          withProjects={withProjects} manage={manage} onFilter={filter} onProjects={setWithProjects} onManage={setManage}
          onClose={() => { setDrawer(""); setManage(false); }} run={run} />
      )}

      {toast && (
        <div className="toast undo" role="status" aria-live="polite">
          <span>{toast.msg}</span>
          {toast.undo && <button type="button" onClick={() => { const u = toast.undo!; setToast(null); run(u); }}>Undo</button>}
        </div>
      )}
    </>
  );
}

// Tabs are grouped: bank accounts, cards, Venmo, then anything kept separate.
const group = (a: SpendAccount) => (a.separate ? 3 : /venmo/i.test(a.fullName) ? 2 : a.bucket === "credit" ? 1 : 0);
const spentLabel = (out: number) => (out > 0.005 ? `${money(out, 0)} spent` : "—");

function Tab({ label, active, onClick, sub }: { label: string; active: boolean; onClick: () => void; sub: string }) {
  return (
    <button type="button" className="atab" aria-current={active ? "true" : undefined} onClick={onClick}>
      <span className="nm">{label}</span><span className="sub num">{sub}</span>
    </button>
  );
}

function MiniPie({ ctx, list }: { ctx: Ctx; list: Txn[] }) {
  const d = sumBy(ctx, list, (p) => p.category).filter((e) => e[1] > 0), sum = d.reduce((s, e) => s + e[1], 0) || 1, C = 2 * Math.PI * 7;
  const lens = d.map(([, v]) => (v / sum) * C);
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" className="mini">
      <circle cx="10" cy="10" r="7" fill="none" stroke="var(--wash)" strokeWidth="5" />
      {d.map(([c], i) => (
        <circle key={c} cx="10" cy="10" r="7" fill="none" stroke={color(ctx, c)} strokeWidth="5" strokeDasharray={`${lens[i]} ${C}`}
          strokeDashoffset={-lens.slice(0, i).reduce((s, l) => s + l, 0)} transform="rotate(-90 10 10)" />
      ))}
    </svg>
  );
}

function Row({ t, ctx, acct, byId, open, ncol, balance, onOpen, run, notify }: {
  t: Txn; ctx: Ctx; acct: string; byId: Map<string, Txn>; open: boolean; ncol: number; balance?: number;
  onOpen: () => void; run: Run; notify: Notify;
}) {
  const sep = separate(ctx, t);
  const pair = t.pairId ? byId.get(t.pairId) : undefined;
  const label = (id: string) => ctx.acct.get(id)?.label ?? "";
  const merged = t.kind === "transfer" && !acct && pair;
  const name = merged ? `${label(t.accountId)} → ${label(pair.accountId)}` : t.merchant;
  const isCard = t.kind === "transfer" && [t.accountId, pair?.accountId].some((id) => id && ctx.acct.get(id)?.bucket === "credit");
  const grey = t.kind === "transfer" || (sep && !acct);
  const o = outstanding(ctx, t.id), share = mine(ctx, t);

  let badge = null;
  if (ctx.owed[t.id]?.length) badge = o > 0.005 ? <span className="tag warn">Owed {money(o)}</span> : <span className="tag good">Settled</span>;
  else if (t.kind === "income" && t.payback) badge = <span className="tag good">Payback</span>;

  let catCell;
  if (t.kind === "transfer") catCell = <span className="cat muted"><span className="dot" style={{ background: "var(--line)" }} />{isCard ? "Card payment" : "Transfer"}</span>;
  else if (t.kind === null) catCell = <span className="cchip rv">Not sorted yet</span>;
  else if (t.kind === "income") catCell = <span className="cat"><span className="dot" style={{ background: "var(--good)" }} />{sep ? "Deposit" : t.payback ? "Paid back" : "Money in"}</span>;
  else if (ctx.splits[t.id]?.length) {
    const cs = [...new Set(ctx.splits[t.id].map((p) => p.category))];
    catCell = <span className="cat">{cs.map((c) => <span key={c} className="dot" style={{ background: color(ctx, c) }} />)}Split · {ctx.splits[t.id].length} parts</span>;
  } else catCell = (
    <span className="cat"><span className="dot" style={{ background: color(ctx, t.category) }} />{t.category}{t.sub && <span className="s">· {t.sub}</span>}
      {t.amount < 0 && <span className="tag">Refund</span>}</span>
  );

  let amountSub = null;
  if (sep) amountSub = "kept separate";
  else if (t.kind === "transfer") amountSub = "not spending";
  else if (ctx.owed[t.id]?.length) amountSub = `your share ${money(share.out)}`;
  else if (t.kind === "income" && t.payback) amountSub = "not income";

  const moneyIn = t.amount < 0;
  return (
    <>
      <tr className={`${grey ? "xfer" : ""} ${open ? "opened" : ""}`}>
        <td className="num muted c-date">{day(t.date)}</td>
        <td className="desc">
          <button type="button" className="rowbtn" aria-expanded={open} onClick={onOpen}>{name}</button>{" "}
          {badge}{t.pending && <span className="tag">Pending</span>}{t.needsReview && <span className="tag warn">Needs a look</span>}
          {t.memo ? <span className="memo">“{t.memo}”</span>
            : t.merchant.toLowerCase() !== t.name.toLowerCase() && <span className="raw">{t.name}</span>}
          {t.note && <span className="note">{t.note}</span>}
          <span className="mmeta">{day(t.date)}{!acct && ` · ${label(t.accountId)}`}</span>
        </td>
        <td className="c-cat">{catCell}</td>
        {!acct && <td className="muted c-acct">{label(t.accountId)}</td>}
        <td className="r num c-amt">
          {grey ? money(t.amount) : <span className={moneyIn ? "in" : ""}>{moneyIn ? "+" : "−"}{money(t.amount)}</span>}
          {amountSub && <span className="raw">{amountSub}</span>}
        </td>
        {balance !== undefined && <td className="r num muted c-bal">{money(balance)}</td>}
      </tr>
      {open && (
        <tr className="det"><td colSpan={ncol}><TxnEditor t={t} ctx={ctx} run={run} notify={notify} /></td></tr>
      )}
    </>
  );
}

type OwedGroup = { name: string; items: { t: Txn; id: number; amount: number }[]; total: number };

/** Everyone who still owes you, biggest first, with their items oldest first. */
function owedGroups(ctx: Ctx, byId: Map<string, Txn>): OwedGroup[] {
  const people = new Map<string, OwedGroup["items"]>();
  for (const [tid, os] of Object.entries(ctx.owed)) {
    const t = byId.get(tid);
    if (!t) continue;
    for (const o of os) if (o.status === "waiting") people.set(o.person, [...(people.get(o.person) ?? []), { t, id: o.id, amount: o.amount }]);
  }
  return [...people].map(([name, items]) => ({ name, items: items.sort((x, y) => x.t.date.localeCompare(y.t.date)), total: items.reduce((s, x) => s + x.amount, 0) }))
    .sort((x, y) => y.total - x.total);
}

function OwedDrawer({ groups, total, todayIso, goto, run, notify, onClose }: {
  groups: OwedGroup[]; total: number; todayIso: string; goto: (t: Txn) => void; run: Run; notify: Notify; onClose: () => void;
}) {
  const days = (iso: string) => Math.round((Date.parse(todayIso) - Date.parse(iso)) / 864e5);
  const paid = (ids: number[], msg: string) => run(async () => {
    await setOwedStatus(ids, "paid");
    notify(msg, () => setOwedStatus(ids, "waiting"));
  });
  return (
    <aside className="drawer" aria-label="Owed to you">
      <div className="ph">
        <div><h2>Owed to you</h2><span className="small muted">{groups.length ? `${groups.length} ${groups.length > 1 ? "people" : "person"}` : "Nothing outstanding"}</span></div>
        <span className="num owed big">{money(total)}</span>
        <button type="button" className="ibtn" aria-label="Close" onClick={onClose}>×</button>
      </div>
      {groups.map((g) => (
        <div key={g.name} className="pgroup">
          <div className="ph">
            <span className="pname">{g.name} <span className="num">{money(g.total)}</span></span>
            <button type="button" className="btn sm" onClick={() => paid(g.items.map((x) => x.id), `Marked ${g.items.length} item${g.items.length > 1 ? "s" : ""} from ${g.name} paid back`)}>All paid back</button>
          </div>
          {g.items.map((x) => (
            <div key={x.id} className="oitem">
              <button type="button" className="paidbox" aria-label={`Mark ${g.name}'s ${money(x.amount)} for ${x.t.merchant} paid back`}
                onClick={() => paid([x.id], `Marked ${g.name}’s ${money(x.amount)} for ${x.t.merchant} paid back`)} />
              <button type="button" className="linkish" onClick={() => goto(x.t)}>
                <span>{x.t.merchant}</span><span className="sub">{day(x.t.date)} · {days(x.t.date)} days</span>
              </button>
              <span className="num">{money(x.amount)}</span>
            </div>
          ))}
        </div>
      ))}
      {groups.length ? (
        <p className="small muted">Tick an item when it’s paid back. Click one to open the transaction.</p>
      ) : (
        <p className="small muted">Nobody owes you anything. Open a purchase and tick “I paid for other people” to track who owes you what.</p>
      )}
    </aside>
  );
}
