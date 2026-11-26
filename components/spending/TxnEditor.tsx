"use client";

import { useState } from "react";
import {
  addSubcategory, createCategory, setCategory, setNote, setOwed, setPayback, setSplits, undoCategory,
} from "@/app/(app)/spending/actions";
import type { Kind } from "@/lib/categories";
import type { Owe, Txn } from "@/lib/data";
import { CategoryPicker } from "./CategoryPicker";
import { money, owedTotal, separate, type Ctx } from "./model";
import type { Notify, Run } from "./SpendingView";

const STATUS = { waiting: "Waiting", paid: "Paid back", gone: "Not coming back" } as const;
type Person = { person: string; amount: number; status: Owe["status"] };

/** Everything you can change about one transaction, shown under its row. */
export function TxnEditor({ t, ctx, run, notify }: { t: Txn; ctx: Ctx; run: Run; notify: Notify }) {
  const [always, setAlways] = useState(false);
  const cats = [...ctx.cats.values()];
  const sep = separate(ctx, t);

  const pickCategory = (kind: Kind, category: string | null, sub: string | null) => run(async () => {
    const { prior, rule } = await setCategory(t.id, kind, category, sub, always);
    const label = kind === "spend" ? `${category}${sub ? ` › ${sub}` : ""}` : kind === "income" ? "money in" : "a transfer";
    notify(prior.length > 1 ? `${prior.length} ${t.merchant} transactions → ${label}` : `${t.merchant} → ${label}`, () => undoCategory(prior, rule));
  });
  const create = (target: (c: string, s: string | null) => void) => async (name: string, o: { parent: string | null; isProject: boolean }) => {
    if (o.parent) { await addSubcategory(o.parent, name); target(o.parent, name); }
    else { await createCategory(name, o.isProject); target(name, null); }
  };

  return (
    <div className="editor">
      {t.needsReview && t.kind && (
        <div className="esec">
          <div className="filters">
            <span className="small">Claude wasn’t sure about this one.</span>
            <button type="button" className="btn sm" onClick={() => pickCategory(t.kind!, t.category, t.sub)}>Looks right</button>
          </div>
        </div>
      )}
      {!sep && (
        <div className="esec">
          <span className="lbl">Counts as</span>
          <div className="seg" role="group" aria-label="What this transaction is">
            {([["spend", "Spending"], ["income", "Money in"], ["transfer", "Transfer, not counted"]] as const).map(([k, l]) => (
              <button key={k} type="button" aria-pressed={t.kind === k}
                onClick={() => t.kind !== k && pickCategory(k, k === "spend" ? (t.category ?? "Other") : null, k === "spend" ? t.sub : null)}>{l}</button>
            ))}
          </div>
        </div>
      )}

      {t.kind === "spend" && !sep && (
        <div className="esec">
          <span className="lbl">Category</span>
          {ctx.splits[t.id]?.length ? (
            <SplitEditor key={JSON.stringify(ctx.splits[t.id])} t={t} ctx={ctx} run={run} create={create} />
          ) : (
            <>
              <div className="filters" style={{ alignItems: "flex-start" }}>
                <CategoryPicker category={t.category} sub={t.sub} categories={cats}
                  onPick={(c, s) => pickCategory("spend", c, s)} onCreate={create((c, s) => pickCategory("spend", c, s))} />
                <button type="button" className="btn sm" onClick={() => run(() => setSplits(t.id, [
                  { category: t.category ?? "Other", sub: t.sub, amount: t.amount }, { category: t.category ?? "Other", sub: t.sub, amount: 0 },
                ]))}>Split into categories</button>
              </div>
              <label className="cb small" htmlFor={`always-${t.id}`}>
                <input type="checkbox" id={`always-${t.id}`} checked={always} onChange={(e) => setAlways(e.target.checked)} />
                Also use this for every {t.merchant} transaction
              </label>
            </>
          )}
        </div>
      )}

      <div className="esec">
        <label className="lbl" htmlFor={`note-${t.id}`}>Note</label>
        <input id={`note-${t.id}`} className="note-in" defaultValue={t.note ?? ""} placeholder="What was this for?" key={t.note ?? ""}
          onBlur={(e) => e.target.value !== (t.note ?? "") && run(() => setNote(t.id, e.target.value))}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
      </div>

      {t.kind === "spend" && t.amount > 0 && !sep && (
        <OwedEditor key={JSON.stringify(ctx.owed[t.id] ?? null)} t={t} ctx={ctx} run={run} />
      )}

      {t.kind === "income" && !sep && (
        <div className="esec">
          <label className="cb" htmlFor={`pb-${t.id}`}>
            <input type="checkbox" id={`pb-${t.id}`} checked={t.payback} onChange={(e) => run(() => setPayback(t.id, e.target.checked))} />
            This is someone paying me back, so don’t count it as money in
          </label>
        </div>
      )}
      {sep && <p className="small muted">This account is kept separate, so nothing in it counts as spending or money in.</p>}
    </div>
  );
}

function SplitEditor({ t, ctx, run, create }: {
  t: Txn; ctx: Ctx; run: Run;
  create: (target: (c: string, s: string | null) => void) => (name: string, o: { parent: string | null; isProject: boolean }) => Promise<void>;
}) {
  const [parts, setParts] = useState(ctx.splits[t.id]);
  const save = (next: typeof parts) => { setParts(next); run(() => setSplits(t.id, next)); };
  const left = Math.round((t.amount - parts.reduce((s, p) => s + p.amount, 0)) * 100) / 100;
  const cats = [...ctx.cats.values()];
  return (
    <>
      <div className="splits">
        {parts.map((p, i) => {
          const setPart = (category: string, sub: string | null) => save(parts.map((x, j) => (j === i ? { ...x, category, sub } : x)));
          return (
            <div key={i} className="splitrow">
              <CategoryPicker category={p.category} sub={p.sub} categories={cats} onPick={setPart} onCreate={create(setPart)} />
              <input type="number" step="0.01" min="0" defaultValue={p.amount} className="num" aria-label={`Amount for part ${i + 1}`}
                onBlur={(e) => +e.target.value !== p.amount && save(parts.map((x, j) => (j === i ? { ...x, amount: Math.max(0, +e.target.value || 0) } : x)))} />
              <button type="button" className="btn sm" aria-label={`Remove part ${i + 1}`}
                onClick={() => save(parts.length > 2 ? parts.filter((_, j) => j !== i) : [])}>Remove</button>
            </div>
          );
        })}
      </div>
      <div className="filters">
        <button type="button" className="btn sm" onClick={() => save([...parts, { category: "Other", sub: null, amount: Math.max(left, 0) }])}>Add part</button>
        <span className={`left ${Math.abs(left) < 0.005 ? "ok" : "off"}`}>
          {Math.abs(left) < 0.005 ? `Adds up to ${money(t.amount)}` : left > 0 ? `${money(left)} left to assign` : `${money(-left)} too much`}
        </span>
        <button type="button" className="btn sm" style={{ marginLeft: "auto" }} onClick={() => save([])}>Undo split</button>
      </div>
    </>
  );
}

function OwedEditor({ t, ctx, run }: { t: Txn; ctx: Ctx; run: Run }) {
  const saved: Person[] = (ctx.owed[t.id] ?? []).map((o) => ({ person: o.person, amount: o.amount, status: o.status }));
  const [people, setPeople] = useState(saved);
  const save = (next: Person[]) => { setPeople(next); run(() => setOwed(t.id, next.length ? next : null)); };
  const round = (n: number) => Math.round(n * 100) / 100;
  const even = (n: number) => save(Array.from({ length: n }, (_, i) => ({
    person: people[i]?.person ?? `Person ${i + 1}`, amount: round(t.amount / (n + 1)), status: people[i]?.status ?? "waiting",
  })));
  const owed = owedTotal(ctx, t.id);
  return (
    <div className="esec">
      <label className="cb" htmlFor={`iou-${t.id}`}>
        <input type="checkbox" id={`iou-${t.id}`} checked={people.length > 0}
          onChange={(e) => save(e.target.checked ? [{ person: "Person 1", amount: round(t.amount / 2), status: "waiting" }] : [])} />
        I paid for other people and expect to be paid back
      </label>
      {people.length > 0 && (
        <>
          <div className="quick small">Split evenly with
            {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" className="btn sm" onClick={() => even(n)}>{n}</button>)}
            others, or <button type="button" className="btn sm" onClick={() => save([{ ...people[0], amount: t.amount }])}>One person owes all of it</button>
          </div>
          <div className="people">
            {people.map((p, i) => (
              <div key={i} className="person">
                <input defaultValue={p.person} aria-label={`Name ${i + 1}`}
                  onBlur={(e) => e.target.value.trim() && e.target.value !== p.person && save(people.map((x, j) => (j === i ? { ...x, person: e.target.value.trim() } : x)))} />
                <input type="number" step="0.01" min="0" defaultValue={p.amount} className="num" aria-label={`Amount ${p.person} owes`}
                  onBlur={(e) => +e.target.value !== p.amount && save(people.map((x, j) => (j === i ? { ...x, amount: Math.max(0, +e.target.value || 0) } : x)))} />
                <select value={p.status} className={`st-${p.status}`} aria-label={`Status for ${p.person}`}
                  onChange={(e) => save(people.map((x, j) => (j === i ? { ...x, status: e.target.value as Person["status"] } : x)))}>
                  {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <button type="button" className="btn sm" onClick={() => save(people.filter((_, j) => j !== i))}>Remove</button>
              </div>
            ))}
          </div>
          <button type="button" className="btn sm" style={{ alignSelf: "flex-start" }}
            onClick={() => save([...people, { person: `Person ${people.length + 1}`, amount: 0, status: "waiting" }])}>Add person</button>
          <p className="small">
            Paid <b className="num">{money(t.amount)}</b> · others owe <b className="num">{money(owed)}</b> · your share{" "}
            <b className="num">{money(t.amount - owed)}</b> counts as your spending. Anything marked “Not coming back” is added to your share.
          </p>
        </>
      )}
    </div>
  );
}
