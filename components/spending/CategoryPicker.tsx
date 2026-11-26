"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Cat } from "@/lib/categories";

type Props = {
  category: string | null;
  sub: string | null;
  categories: Cat[];
  disabled?: boolean;
  onPick: (category: string, sub: string | null) => void;
  /** Make a new category (or sub-category when `parent` is set), then pick it. */
  onCreate: (name: string, opts: { parent: string | null; isProject: boolean }) => Promise<void>;
};

const label = (c: string | null, s: string | null) => (c ? `${c}${s ? ` › ${s}` : ""}` : "Choose a category");

/** Categories first, like folders: click into one for its sub-categories, or pick the whole category. */
export function CategoryPicker({ category, sub, categories, disabled, onPick, onCreate }: Props) {
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const live = categories.filter((c) => !c.finishedOn);
  const dot = (c: string) => <span className="dot" style={{ background: `var(--${categories.find((x) => x.name === c)?.color ?? "g11"})` }} />;
  const pick = (c: string, s: string | null) => { onPick(c, s); setOpen(false); };
  const opt = (c: string, s: string | null, text: ReactNode) => (
    <button key={`${c}|${s ?? ""}`} type="button" className="popt" onClick={() => pick(c, s)}>
      {dot(c)}<span>{text}</span>{category === c && (sub ?? null) === s && <span className="tick">✓</span>}
    </button>
  );
  const start = () => { setOpen(!open); setLevel(null); setQ(""); setAdding(false); };
  const add = async (isProject: boolean) => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      await onCreate(newName.trim(), { parent: level, isProject });
      setOpen(false);
    } finally { setBusy(false); }
  };

  let body: ReactNode;
  if (q) {
    const ql = q.toLowerCase(), hits: [string, string | null][] = [];
    for (const c of live) {
      const hit = c.name.toLowerCase().includes(ql);
      if (hit) hits.push([c.name, null]);
      for (const s of c.subs) if (hit || s.toLowerCase().includes(ql)) hits.push([c.name, s]);
    }
    body = hits.length ? hits.map(([c, s]) => opt(c, s, label(c, s))) : <p className="small muted pempty">No match. Add “{q}” below.</p>;
  } else if (!level) {
    body = ([["Categories", false], ["Projects", true]] as const).map(([title, proj]) => {
      const cs = live.filter((c) => c.isProject === proj);
      return cs.length ? (
        <div key={title}>
          <div className="psec">{title}</div>
          {cs.map((c) => c.subs.length ? (
            <button key={c.name} type="button" className="popt" onClick={() => setLevel(c.name)}>
              {dot(c.name)}<span>{c.name}</span>{category === c.name && <span className="tick">✓</span>}<span className="into">{c.subs.length} ›</span>
            </button>
          ) : opt(c.name, null, c.name))}
        </div>
      ) : null;
    });
  } else {
    const c = live.find((x) => x.name === level)!;
    body = (
      <>
        <button type="button" className="popt back" onClick={() => setLevel(null)}><span>‹ All categories</span></button>
        {opt(c.name, null, <>All of {c.name} <span className="muted small">no sub-category</span></>)}
        <div className="psec">{c.name}</div>
        {c.subs.map((s) => opt(c.name, s, s))}
      </>
    );
  }

  return (
    <div className="pickwrap" ref={box}>
      <button type="button" className="pickbtn" aria-expanded={open} aria-haspopup="dialog" disabled={disabled} onClick={start}>
        {category ? dot(category) : null}<span>{label(category, sub)}</span><span className="chev">▾</span>
      </button>
      {open && (
        <div className="pop" role="dialog" aria-label="Choose a category">
          <input type="search" placeholder="Search categories" value={q} aria-label="Search categories" autoFocus
            onChange={(e) => { setQ(e.target.value); setAdding(false); }} />
          <div className="plist">{body}</div>
          {adding ? (
            <div className="padd">
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={level ? `New sub-category in ${level}` : "Name"}
                aria-label="New category name" autoFocus onKeyDown={(e) => { if (e.key === "Enter" && level) add(false); }} />
              {level ? (
                <button type="button" className="btn sm primary" disabled={busy || !newName.trim()} onClick={() => add(false)}>{busy ? "Adding…" : "Add"}</button>
              ) : (
                <>
                  <button type="button" className="btn sm" disabled={busy || !newName.trim()} onClick={() => add(false)}>Add as category</button>
                  <button type="button" className="btn sm" disabled={busy || !newName.trim()} onClick={() => add(true)}>Add as project</button>
                  <span className="small muted">A project is temporary, like a trip.</span>
                </>
              )}
            </div>
          ) : (
            <button type="button" className="popt add" onClick={() => { setAdding(true); setNewName(q); }}>
              <span>+ New {level ? `sub-category in ${level}` : "category or project"}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
