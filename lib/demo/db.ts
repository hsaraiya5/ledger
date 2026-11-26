// Demo mode's stand-in for Supabase: the subset of the query builder this app uses, run over the made-up
// household in seed.ts. A visitor's edits are kept as a diff from the seed in a cookie, so they stick for
// that browser only and every server instance can rebuild the same state.
import "server-only";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { cacheLife } from "next/cache";
import { cookies } from "next/headers";
import { cache } from "react";
import { buildDemo, type Row, type Tables } from "@/lib/demo/seed";

const COOKIE = "ledger_demo";
const CHUNKS = 4, CHUNK = 3800; // ~15 KB of compressed edits, split to stay under per-cookie limits

/** Each table's key, for diffing and upserts. */
const KEYS: Record<string, string[]> = {
  plaid_items: ["id"], accounts: ["id"], balance_snapshots: ["account_id", "as_of"], holdings: ["account_id", "as_of", "security_id"],
  investment_transactions: ["id"], transactions: ["id"], transaction_splits: ["id"], owed: ["id"], categories: ["name"],
  subcategories: ["category", "name"], category_rules: ["id"], manual_cost: ["account_id", "ticker"],
};
/** Tables whose id the database assigns. */
const IDENTITY = new Set(["transaction_splits", "owed", "category_rules"]);
/** Embedded selects this app uses: `accounts!inner(...)` on transactions, `subcategories(...)` on categories. */
const RELATIONS: Record<string, Record<string, { many: boolean; match: (row: Row, other: Row) => boolean }>> = {
  transactions: { accounts: { many: false, match: (t, a) => a.id === t.account_id } },
  categories: { subcategories: { many: true, match: (c, s) => s.category === c.name } },
};

const keyOf = (table: string, row: Row) => KEYS[table].map((k) => String(row[k])).join("|");
/** The made-up household, rebuilt every few hours so it keeps up with the calendar. Every visitor shares it read-only. */
async function seed() {
  "use cache";
  cacheLife("hours");
  return buildDemo();
}

type Diff = { k: string; t: Record<string, { up?: Row[]; del?: string[] }> };

async function readDiff(): Promise<Diff | null> {
  const jar = await cookies();
  let raw = "";
  for (let i = 0; i < CHUNKS; i++) raw += jar.get(`${COOKIE}_${i}`)?.value ?? "";
  if (!raw) return null;
  try { return JSON.parse(inflateRawSync(Buffer.from(raw, "base64url")).toString()); } catch { return null; }
}

/** This request's copy of the demo data: the seed with the visitor's edits applied. */
const state = cache(async (): Promise<Tables> => {
  const diff = await readDiff();
  const { key, tables } = await seed();
  const db: Tables = structuredClone(tables);
  // Edits made against last month's data no longer line up with this month's, so they're dropped.
  if (diff?.k !== key) return db;
  for (const [table, { up = [], del = [] }] of Object.entries(diff.t)) {
    const rows = db[table];
    const gone = new Set(del);
    const idx = new Map(rows.map((r, i) => [keyOf(table, r), i]));
    for (const patch of up) {
      const i = idx.get(keyOf(table, patch));
      if (i === undefined) rows.push(patch);
      else rows[i] = { ...rows[i], ...patch };
    }
    db[table] = rows.filter((r) => !gone.has(keyOf(table, r)));
  }
  return db;
});

/** Store how this visitor's data differs from the seed: changed fields, added rows, deleted keys. */
async function persist(db: Tables) {
  const { key, tables } = await seed();
  const diff: Diff = { k: key, t: {} };
  for (const [table, base] of Object.entries(tables)) {
    const now = new Map(db[table].map((r) => [keyOf(table, r), r]));
    const up: Row[] = [], del: string[] = [];
    for (const b of base) {
      const k = keyOf(table, b), r = now.get(k);
      if (!r) { del.push(k); continue; }
      const changed = Object.keys(r).filter((f) => JSON.stringify(r[f]) !== JSON.stringify(b[f]));
      if (changed.length) up.push(Object.fromEntries([...KEYS[table], ...changed].map((f) => [f, r[f]])));
      now.delete(k);
    }
    up.push(...now.values());
    if (up.length || del.length) diff.t[table] = { ...(up.length && { up }), ...(del.length && { del }) };
  }
  const raw = deflateRawSync(JSON.stringify(diff)).toString("base64url");
  if (raw.length > CHUNKS * CHUNK) throw new Error("The demo has run out of room for your edits. Use Reset demo in the sidebar to start fresh.");
  const jar = await cookies();
  for (let i = 0; i < CHUNKS; i++) {
    const part = raw.slice(i * CHUNK, (i + 1) * CHUNK);
    if (part) jar.set(`${COOKIE}_${i}`, part, { path: "/", maxAge: 60 * 60 * 24 * 30, sameSite: "lax", httpOnly: true });
    else jar.delete(`${COOKIE}_${i}`);
  }
}

export async function resetDemo() {
  const jar = await cookies();
  for (let i = 0; i < CHUNKS; i++) jar.delete(`${COOKIE}_${i}`);
}

/** Month-end prices for the demo's funds, in the shape lib/prices returns. */
export async function demoPrices(tickers: string[]) {
  const { prices } = await seed();
  return Object.fromEntries(tickers.filter((t) => prices[t]).map((t) => [t, prices[t]]));
}

// ---- Query builder ----

type Filter = (row: Row) => boolean;
type Result = { data: unknown; error: { message: string } | null; count?: number | null };

const get = (row: Row, path: string) => path.split(".").reduce<unknown>((v, k) => (v as Row | undefined)?.[k], row);
// Postgres compares null as unknown, so a null column never matches eq/neq/gte.
const known = (v: unknown) => v !== null && v !== undefined;

class Query implements PromiseLike<Result> {
  private filters: Filter[] = [];
  private orders: { col: string; asc: boolean }[] = [];
  private embeds: { rel: string; inner: boolean }[] = [];
  private op: "select" | "update" | "insert" | "upsert" | "delete" = "select";
  private payload: Row | Row[] | null = null;
  private opts: { onConflict?: string; ignoreDuplicates?: boolean; count?: string; head?: boolean } = {};
  private max: number | null = null;
  private one: "single" | "maybe" | null = null;

  constructor(private table: string) {
    if (!KEYS[table]) throw new Error(`Demo mode has no table called ${table}.`);
  }

  select(cols = "*", opts: { count?: string; head?: boolean } = {}) {
    if (this.op === "select") this.opts = { ...this.opts, ...opts };
    for (const m of cols.matchAll(/(\w+)(!inner)?\s*\(/g)) this.embeds.push({ rel: m[1], inner: !!m[2] });
    return this;
  }
  update(patch: Row) { this.op = "update"; this.payload = patch; return this; }
  insert(rows: Row | Row[]) { this.op = "insert"; this.payload = rows; return this; }
  upsert(rows: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) { this.op = "upsert"; this.payload = rows; this.opts = opts; return this; }
  delete() { this.op = "delete"; return this; }

  eq(col: string, v: unknown) { this.filters.push((r) => known(get(r, col)) && get(r, col) === v); return this; }
  neq(col: string, v: unknown) { this.filters.push((r) => known(get(r, col)) && get(r, col) !== v); return this; }
  gte(col: string, v: string | number) { this.filters.push((r) => known(get(r, col)) && (get(r, col) as string | number) >= v); return this; }
  gt(col: string, v: string | number) { this.filters.push((r) => known(get(r, col)) && (get(r, col) as string | number) > v); return this; }
  in(col: string, vs: unknown[]) { this.filters.push((r) => vs.includes(get(r, col))); return this; }
  ilike(col: string, pattern: string) {
    const re = new RegExp("^" + pattern.split("%").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$", "i");
    this.filters.push((r) => re.test(String(get(r, col) ?? "")));
    return this;
  }
  order(col: string, opts: { ascending?: boolean } = {}) { this.orders.push({ col, asc: opts.ascending !== false }); return this; }
  limit(n: number) { this.max = n; return this; }
  single() { this.one = "single"; return this; }
  maybeSingle() { this.one = "maybe"; return this; }

  then<A = Result, B = never>(ok?: ((r: Result) => A | PromiseLike<A>) | null, fail?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return this.run().then(ok, fail);
  }

  private async run(): Promise<Result> {
    const db = await state();
    const rows = db[this.table];
    const withEmbeds = (r: Row) => {
      const out: Row = { ...r };
      for (const { rel } of this.embeds) {
        const spec = RELATIONS[this.table]?.[rel];
        if (!spec) throw new Error(`Demo mode can't embed ${rel} in ${this.table}.`);
        const found = db[rel].filter((o) => spec.match(r, o));
        out[rel] = spec.many ? found : found[0] ?? null;
      }
      return out;
    };
    const matching = () => rows.map(withEmbeds).filter((r) =>
      this.embeds.every((e) => !e.inner || r[e.rel]) && this.filters.every((f) => f(r)));

    if (this.op === "select") {
      let out = matching();
      for (const { col, asc } of [...this.orders].reverse()) {
        out = [...out].sort((a, b) => {
          const x = get(a, col) as string | number, y = get(b, col) as string | number;
          return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
        });
      }
      if (this.max !== null) out = out.slice(0, this.max);
      if (this.opts.head) return { data: null, error: null, count: out.length };
      if (this.one) {
        if (out.length > 1 || (this.one === "single" && !out.length)) return { data: null, error: { message: `Expected one ${this.table} row, found ${out.length}.` } };
        return { data: structuredClone(out[0] ?? null), error: null };
      }
      return { data: structuredClone(out), error: null, count: this.opts.count ? out.length : null };
    }

    if (this.op === "update") {
      const keys = new Set(matching().map((r) => keyOf(this.table, r)));
      for (const r of rows) if (keys.has(keyOf(this.table, r))) {
        // Sub-categories follow a renamed category (on update cascade).
        if (this.table === "categories" && "name" in this.payload! && this.payload!.name !== r.name)
          for (const s of db.subcategories) if (s.category === r.name) s.category = this.payload!.name;
        Object.assign(r, this.payload);
      }
    } else if (this.op === "delete") {
      const gone = matching();
      const keys = new Set(gone.map((r) => keyOf(this.table, r)));
      db[this.table] = rows.filter((r) => !keys.has(keyOf(this.table, r)));
      // A deleted category takes its sub-categories with it (on delete cascade).
      if (this.table === "categories") db.subcategories = db.subcategories.filter((s) => !gone.some((c) => c.name === s.category));
    } else {
      const incoming = (Array.isArray(this.payload) ? this.payload : [this.payload!]).map((r): Row => ({ created_at: new Date().toISOString(), ...r }));
      const conflict = this.opts.onConflict?.split(",").map((s) => s.trim()) ?? KEYS[this.table];
      const sameAs = (a: Row) => (b: Row) => conflict.every((k) => a[k] === b[k]);
      for (const r of incoming) {
        const existing = this.op === "upsert" ? rows.find(sameAs(r)) : undefined;
        if (existing) { if (!this.opts.ignoreDuplicates) Object.assign(existing, r); continue; }
        if (IDENTITY.has(this.table) && r.id === undefined) r.id = Math.max(0, ...rows.map((x) => Number(x.id))) + 1;
        rows.push(r);
      }
    }
    await persist(db);
    return { data: null, error: null };
  }
}

/** Shaped like a Supabase client for the calls this app makes. */
export function demoClient() {
  return {
    from: (table: string) => new Query(table),
    auth: {
      getClaims: async () => ({ data: { claims: { email: "demo@example.com", sub: "demo" } }, error: null }),
      signOut: async () => ({ error: null }),
    },
  };
}
