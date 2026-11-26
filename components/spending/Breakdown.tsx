"use client";

import { useState, type ReactNode } from "react";
import { addSubcategory, createCategory, deleteCategory, removeSubcategory, renameCategory, updateCategory } from "@/app/(app)/spending/actions";
import type { Cat } from "@/lib/categories";
import type { Txn } from "@/lib/data";
import { MS } from "@/lib/ledger";
import { color, money, parts, pctOf, sumBy, type Ctx } from "./model";
import type { Run } from "./SpendingView";

type Props = {
  ctx: Ctx;
  scoped: Txn[]; // transactions in the selected range and account
  all: Txn[]; // everything loaded, for a project's whole-life total
  months: number;
  rangeLabel: string;
  cat: string;
  sub: string;
  withProjects: boolean;
  manage: boolean;
  onFilter: (cat: string, sub: string) => void;
  onProjects: (v: boolean) => void;
  onManage: (v: boolean) => void;
  onClose: () => void;
  run: Run;
};

function Donut({ data, total, label, onPick }: { data: { key: string; label: string; v: number; color: string }[]; total: number; label: string; onPick: (key: string) => void }) {
  const R = 78, C = 2 * Math.PI * R, shown = data.filter((d) => d.v > 0), sum = shown.reduce((s, d) => s + d.v, 0) || 1;
  const lens = shown.map((d) => (d.v / sum) * C);
  const starts = lens.map((_, i) => lens.slice(0, i).reduce((s, l) => s + l, 0));
  return (
    <svg className="donut" viewBox="0 0 220 220" role="img" aria-label={`${money(total, 0)} ${label}`}>
      <circle cx="110" cy="110" r={R} fill="none" stroke="var(--wash)" strokeWidth="30" />
      {shown.map((d, i) => {
        const gap = shown.length > 1 ? Math.min(2, lens[i] / 3) : 0;
        return (
          <circle key={d.key} className="slice" cx="110" cy="110" r={R} fill="none" stroke={d.color} strokeWidth="30"
            strokeDasharray={`${Math.max(lens[i] - gap, 0.01)} ${C}`} strokeDashoffset={-starts[i]} transform="rotate(-90 110 110)" onClick={() => onPick(d.key)}>
            <title>{`${d.label}: ${money(d.v)}`}</title>
          </circle>
        );
      })}
      <text className="c1" x="110" y="112" textAnchor="middle">{money(total, 0)}</text>
      <text className="c2" x="110" y="132" textAnchor="middle">{label}</text>
    </svg>
  );
}

const since = (c: Cat) => (c.startedOn ? `${MS[+c.startedOn.slice(5, 7) - 1]} ${c.startedOn.slice(0, 4)}` : null);

export function Breakdown(p: Props) {
  const { ctx, scoped, all, months } = p;
  const life = (name: string) => all.reduce((s, t) => s + parts(ctx, t).filter((x) => x.category === name).reduce((a, x) => a + x.v, 0), 0);
  const isProject = (name: string) => !!ctx.cats.get(name)?.isProject;

  let body: ReactNode;
  if (p.cat) {
    const c = ctx.cats.get(p.cat), proj = isProject(p.cat);
    // A project is shown over its whole life; regular categories follow the selected range.
    const subs = sumBy(ctx, proj ? all : scoped, (x) => x.sub ?? `${p.cat} (no sub-category)`, (x) => x.category === p.cat);
    const tot = subs.reduce((s, e) => s + e[1], 0);
    const inRange = sumBy(ctx, scoped, (x) => x.category, (x) => x.category === p.cat).reduce((s, e) => s + e[1], 0);
    const shade = (i: number) => `color-mix(in srgb, ${color(ctx, p.cat)} ${Math.max(35, 100 - i * 18)}%, var(--surface))`;
    const subKey = (s: string) => (s.endsWith("(no sub-category)") ? "" : s);
    body = (
      <>
        <div className="crumbs"><button type="button" onClick={() => p.onFilter("", "")}>‹ All spending</button></div>
        <div><h3>{p.cat}</h3><span className="small muted">{proj ? `Project${c && since(c) ? ` since ${since(c)}` : ""}${c?.finishedOn ? " · finished" : ""}` : p.rangeLabel}</span></div>
        <div className="dpie">
          <Donut data={subs.map(([s, v], i) => ({ key: s, label: s, v, color: shade(i) }))} total={tot}
            label={proj ? "whole project" : months > 1 ? `avg ${money(tot / months, 0)}/mo` : p.rangeLabel}
            onPick={(s) => p.onFilter(p.cat, p.sub === subKey(s) ? "" : subKey(s))} />
        </div>
        <div className="lgroup">
          {subs.map(([s, v], i) => (
            <button key={s} type="button" className="lrow" aria-pressed={p.sub === subKey(s) && !!p.sub}
              onClick={() => p.onFilter(p.cat, p.sub === subKey(s) ? "" : subKey(s))}>
              <i style={{ background: shade(i) }} /><span>{s}</span><span className="num">{money(v)}</span><span className="pct num">{pctOf(v, tot)}</span>
            </button>
          ))}
          {!subs.length && <p className="small muted">Nothing here in this range.</p>}
        </div>
        <p className="small muted">
          {proj ? `${money(inRange)} of it falls in ${p.rangeLabel}. ` : ""}The transactions table is filtered to {p.sub || p.cat}.
          Pick a sub-category to narrow it, or pick it again to go back to all of {p.cat}.
        </p>
      </>
    );
  } else {
    const rows = sumBy(ctx, scoped, (x) => x.category);
    const shown = rows.filter(([c]) => p.withProjects || !isProject(c)), total = shown.reduce((s, e) => s + e[1], 0);
    const section = (title: string, proj: boolean) => {
      const rs = rows.filter(([c]) => isProject(c) === proj), out = proj && !p.withProjects;
      if (!rs.length) return null;
      return (
        <div className={`lgroup ${out ? "dim" : ""}`}>
          <div className="lhead"><span>{title}{out ? " · not in the chart" : ""}</span><span className="num">{money(rs.reduce((s, e) => s + e[1], 0))}</span></div>
          {rs.map(([c, v]) => (
            <button key={c} type="button" className="lrow" onClick={() => p.onFilter(c, "")}>
              <i style={{ background: color(ctx, c) }} />
              <span>{c}{proj && <span className="sub">{money(life(c), 0)} whole project</span>}</span>
              <span className="num">{v < 0 ? "−" : ""}{money(v)}</span><span className="pct num">{out || v < 0 ? "" : pctOf(v, total)}</span>
            </button>
          ))}
        </div>
      );
    };
    body = (
      <>
        {rows.some(([c]) => isProject(c)) && (
          <div className="seg" role="group" aria-label="Projects in the chart">
            <button type="button" aria-pressed={p.withProjects} onClick={() => p.onProjects(true)}>With projects</button>
            <button type="button" aria-pressed={!p.withProjects} onClick={() => p.onProjects(false)}>Without projects</button>
          </div>
        )}
        <div className="dpie">
          <Donut data={shown.map(([c, v]) => ({ key: c, label: c, v, color: color(ctx, c) }))} total={total}
            label={months > 1 ? `avg ${money(total / months, 0)}/mo` : `spent ${p.rangeLabel}`} onPick={(c) => p.onFilter(c, "")} />
        </div>
        {section("Categories", false)}
        {section("Projects", true)}
        {!rows.length && <p className="small muted">No spending in this range.</p>}
      </>
    );
  }

  return (
    <aside className="drawer" aria-label="Spending breakdown">
      <div className="ph">
        <div><h2>{p.manage ? "Categories" : "Breakdown"}</h2><span className="small muted">{p.manage ? "Changes apply to every transaction" : p.rangeLabel}</span></div>
        <button type="button" className="ibtn" aria-label="Close breakdown" onClick={p.onClose}>×</button>
      </div>
      {p.manage ? <Manager ctx={ctx} life={life} count={(name) => all.filter((t) => t.category === name).length} run={p.run} /> : body}
      <button type="button" className="btn sm" style={{ alignSelf: "flex-start" }} onClick={() => p.onManage(!p.manage)}>
        {p.manage ? "‹ Back to breakdown" : "Edit categories"}
      </button>
    </aside>
  );
}

function Manager({ ctx, life, count, run }: { ctx: Ctx; life: (name: string) => number; count: (name: string) => number; run: Run }) {
  const cats = [...ctx.cats.values()];
  const col = (title: string, proj: boolean, help: string) => (
    <div className="mcol">
      <div className="lhead"><span>{title}</span></div>
      <p className="small muted">{help}</p>
      {cats.filter((c) => c.isProject === proj).map((c) => (
        <div key={c.name} className={`gcard ${c.finishedOn ? "done" : ""}`}>
          <div className="ghead">
            <i style={{ background: `var(--${c.color})` }} />
            <input defaultValue={c.name} aria-label="Category name" key={c.name}
              onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== c.name && run(() => renameCategory(c.name, e.target.value))}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
            <select value={c.isProject ? "p" : "c"} aria-label={`Kind for ${c.name}`} onChange={(e) => run(() => updateCategory(c.name, { is_project: e.target.value === "p" }))}>
              <option value="c">Category</option><option value="p">Project</option>
            </select>
          </div>
          <div className="subs">
            {c.subs.map((s) => (
              <span key={s} className="subchip">{s}
                <button type="button" aria-label={`Remove ${s}`} onClick={() => run(() => removeSubcategory(c.name, s))}>×</button>
              </span>
            ))}
            <input placeholder="+ sub-category" aria-label={`Add sub-category to ${c.name}`} style={{ width: 130 }}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
              onBlur={(e) => { const v = e.target.value.trim(); if (v) { e.target.value = ""; run(() => addSubcategory(c.name, v)); } }} />
          </div>
          {c.isProject && (
            <div className="ph">
              <span className="small muted">{since(c) ? `Since ${since(c)} · ` : ""}{money(life(c.name), 0)}{c.finishedOn ? " · finished" : ""}</span>
              <button type="button" className="btn sm" onClick={() => run(() => updateCategory(c.name, { finished: !c.finishedOn }))}>
                {c.finishedOn ? "Reopen" : "Finish project"}
              </button>
            </div>
          )}
          <DeleteCategory c={c} others={cats.filter((x) => x.name !== c.name && !x.finishedOn)} count={count(c.name)} run={run} />
        </div>
      ))}
      <NewCategory proj={proj} run={run} />
    </div>
  );
  return (
    <>
      {col("Categories", false, "Your regular spending. Removing a sub-category keeps its transactions in the category.")}
      {col("Projects", true, "Temporary, like a wedding or a trip. Counted in your spending, with a running total. Finishing one hides it from the pickers.")}
    </>
  );
}

function NewCategory({ proj, run }: { proj: boolean; run: Run }) {
  return (
    <input placeholder={proj ? "+ Start a project (e.g. Austin trip)" : "+ Add a category"} aria-label={proj ? "New project name" : "New category name"}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
      onBlur={(e) => { const v = e.target.value.trim(); if (v) { e.target.value = ""; run(() => createCategory(v, proj)); } }} />
  );
}

/** Deleting asks where its transactions go first, so nothing ends up uncategorized. */
function DeleteCategory({ c, others, count, run }: { c: Cat; others: Cat[]; count: number; run: Run }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(others.find((x) => x.name === "Other")?.name ?? others[0]?.name ?? "");
  const [keepSubs, setKeepSubs] = useState(true);
  if (!open) return <button type="button" className="linkbtn" onClick={() => setOpen(true)}>Delete {c.isProject ? "project" : "category"}</button>;
  return (
    <div className="delbox">
      <label className="small" htmlFor={`move-${c.name}`}>
        {count ? `Move its ${count} transaction${count > 1 ? "s" : ""} to` : "Move anything in it to"}
      </label>
      <select id={`move-${c.name}`} value={to} onChange={(e) => setTo(e.target.value)}>
        {others.map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
      </select>
      {c.subs.length > 0 && (
        <label className="cb small" htmlFor={`keep-${c.name}`}>
          <input type="checkbox" id={`keep-${c.name}`} checked={keepSubs} onChange={(e) => setKeepSubs(e.target.checked)} />
          Keep {c.subs.join(", ")} as sub-categories of {to}
        </label>
      )}
      <div className="filters">
        <button type="button" className="btn sm danger" disabled={!to} onClick={() => run(() => deleteCategory(c.name, to, keepSubs))}>Delete {c.name}</button>
        <button type="button" className="btn sm" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}
