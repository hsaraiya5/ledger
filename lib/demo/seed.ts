// A made-up household for demo mode, shaped exactly like the database tables. Everything is generated from
// fixed seeds, so every visitor sees the same data; it's anchored to the current month so it always looks current.
import "server-only";

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

/** Small deterministic PRNG, seeded by a string. */
function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r2 = (n: number) => Math.round(n * 100) / 100;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const ymOf = (y: number, m: number) => y * 12 + m;
const lastDay = (ym: number) => iso(new Date(Date.UTC(Math.floor(ym / 12), (ym % 12) + 1, 0)));

// ---- Accounts ----

const ITEMS: Row[] = [
  ["i-chase", "Chase"], ["i-amex", "American Express"], ["i-fid", "Fidelity"], ["i-vg", "Vanguard"],
  ["i-schwab", "Charles Schwab"], ["i-etrade", "E*TRADE"], ["i-ally", "Ally Bank"], ["i-venmo", "Venmo"],
].map(([id, name]) => ({
  id, institution_name: name, products: [id === "i-fid" || id === "i-vg" || id === "i-schwab" || id === "i-etrade" ? "investments" : "transactions"],
  access_token_enc: "demo", status: id === "i-ally" ? "needs_login" : "ok",
  last_error: id === "i-ally" ? "Ally needs you to sign in again." : null, created_at: "2025-01-04T12:00:00Z",
}));

type Acct = [id: string, name: string, institution: string, bucket: string, tax: string, item: string | null, extra?: Row];
const ACCOUNTS: Acct[] = [
  ["r-401k", "401(k)", "Fidelity", "retirement", "Roth + Trad", "i-fid"],
  ["r-roth", "Roth IRA", "Vanguard", "retirement", "Roth", "i-vg"],
  ["r-rollover", "Rollover IRA", "Charles Schwab", "retirement", "Traditional", "i-schwab"],
  ["b-schwab", "Individual brokerage", "Charles Schwab", "brokerage", "Taxable", "i-schwab"],
  ["b-stock", "Stock plan", "E*TRADE", "brokerage", "Taxable", "i-etrade"],
  ["c-chase", "Chase", "Chase", "cash", "Taxable", null],
  ["c-chk", "Total Checking", "Chase", "cash", "checking", "i-chase", { parent_id: "c-chase", nickname: "Chase Checking", mask: "4821" }],
  ["c-sav", "Premier Savings", "Chase", "cash", "savings", "i-chase", { parent_id: "c-chase", nickname: "Chase Savings", mask: "9930" }],
  ["c-trip", "Travel Savings", "Chase", "cash", "savings", "i-chase", { parent_id: "c-chase", nickname: "Travel fund", mask: "1187", kept_separate: true }],
  ["c-ally", "Online Savings", "Ally Bank", "cash", "savings", "i-ally", { nickname: "Ally Savings", mask: "5512" }],
  ["c-venmo", "Venmo", "Venmo", "cash", "checking", "i-venmo", { nickname: "Venmo" }],
  ["k-amex", "Gold Card", "American Express", "credit", "credit card", "i-amex", { nickname: "Amex Gold", mask: "1004" }],
  ["k-sapph", "Sapphire Preferred", "Chase", "credit", "credit card", "i-chase", { nickname: "Sapphire", mask: "7745" }],
];

// ---- Market ----

// A made-up yearly market path (with a 2022 drawdown), spread over months with noise.
const YEAR_RETURN: Record<number, number> = { 2021: 0.24, 2022: -0.18, 2023: 0.22, 2024: 0.21, 2025: 0.14, 2026: 0.11, 2027: 0.08 };
type Fund = { ticker: string; name: string; beta: number; drift: number; vol: number; price: number };
const FUNDS: Record<string, Fund> = {
  FXAIX: { ticker: "FXAIX", name: "Fidelity 500 Index Fund", beta: 1, drift: 0, vol: 0.01, price: 231.4 },
  FXNAX: { ticker: "FXNAX", name: "Fidelity U.S. Bond Index Fund", beta: 0.15, drift: 0.001, vol: 0.006, price: 10.62 },
  VTSAX: { ticker: "VTSAX", name: "Vanguard Total Stock Market Index Fund Admiral", beta: 1.02, drift: 0, vol: 0.011, price: 152.8 },
  VTIAX: { ticker: "VTIAX", name: "Vanguard Total International Stock Index Fund Admiral", beta: 0.75, drift: -0.002, vol: 0.012, price: 38.9 },
  SWPPX: { ticker: "SWPPX", name: "Schwab S&P 500 Index Fund", beta: 1, drift: 0, vol: 0.01, price: 18.75 },
  VTI: { ticker: "VTI", name: "Vanguard Total Stock Market ETF", beta: 1.02, drift: 0, vol: 0.011, price: 331.2 },
  VXUS: { ticker: "VXUS", name: "Vanguard Total International Stock ETF", beta: 0.75, drift: -0.002, vol: 0.012, price: 71.4 },
  AAPL: { ticker: "AAPL", name: "Apple Inc.", beta: 1.2, drift: 0.003, vol: 0.06, price: 268.5 },
  LDGR: { ticker: "LDGR", name: "Lodestar Robotics Inc.", beta: 1.6, drift: 0.008, vol: 0.09, price: 84.1 },
};

/** Month-end prices per fund, ending at today's price; earlier months walk back along the market path. */
function pricePaths(from: number, to: number) {
  const mkt: Record<number, number> = {};
  const r = rng("market");
  for (let ym = from; ym <= to; ym++) mkt[ym] = Math.pow(1 + (YEAR_RETURN[Math.floor(ym / 12)] ?? 0.08), 1 / 12) - 1 + (r() - 0.5) * 0.05;
  const out: Record<string, Record<number, number>> = {};
  for (const f of Object.values(FUNDS)) {
    const rf = rng("fund:" + f.ticker);
    const p: Record<number, number> = { [to]: f.price };
    for (let ym = to; ym > from; ym--) {
      const ret = f.beta * mkt[ym] + f.drift + (rf() - 0.5) * 2 * f.vol;
      p[ym - 1] = Math.max(0.5, p[ym] / (1 + ret));
    }
    out[f.ticker] = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, r2(v)]));
  }
  return { mkt, prices: out };
}

// ---- Build ----

export type Demo = { key: string; tables: Tables; prices: Record<string, Record<number, number>> };

export function buildDemo(today = new Date()): Demo {
  const y = today.getUTCFullYear(), m = today.getUTCMonth();
  const now = ymOf(y, m), start = ymOf(2021, 0), todayIso = iso(today);
  const { mkt, prices } = pricePaths(start - 1, now);
  const px = (t: string, ym: number) => prices[t][ym];
  const dateIn = (ym: number, day: number) => {
    const d = iso(new Date(Date.UTC(Math.floor(ym / 12), ym % 12, day)));
    return d > todayIso ? null : d;
  };

  const accounts: Row[] = ACCOUNTS.map(([id, name, institution, bucket, tax, item, extra], i) => ({
    id, name, institution, bucket, tax_treatment: tax, data_source: "plaid", sort_order: i, hidden: false, parent_id: null,
    plaid_item_id: item, plaid_account_id: item ? `pa-${id}` : null, mask: null, nickname: null, kept_separate: false,
    created_at: "2025-01-04T12:00:00Z", ...extra,
  }));
  const items = ITEMS.map((it) => ({ ...it, last_synced_at: new Date(today.getTime() - 3 * 3600e3).toISOString() }));

  const snaps: Row[] = [], holdings: Row[] = [], invTx: Row[] = [];
  const snap = (account_id: string, ym: number, balance: number) =>
    snaps.push({ account_id, as_of: ym === now ? todayIso : lastDay(ym), balance: r2(balance), source: ym < ymOf(2025, 0) ? "sheet" : "plaid" });
  let txSeq = 0;
  const itx = (account_id: string, date: string, type: string, subtype: string | null, name: string, ticker: string | null, qty: number, price: number) =>
    invTx.push({ id: `it-${++txSeq}`, account_id, date, type, subtype, name, ticker, quantity: Math.round(qty * 1e4) / 1e4, price, amount: r2(qty * price) });

  // Retirement and brokerage accounts that hold funds: grow along the market, add contributions, split across funds.
  type Plan = { id: string; startBal: number; mix: Record<string, number>; monthly: (ym: number) => { you: number; employer: number }; label: (t: string, who: "you" | "employer") => string; costBasis: boolean };
  const plans: Plan[] = [
    { id: "r-401k", startBal: 41_000, mix: { FXAIX: 0.82, FXNAX: 0.18 }, costBasis: false,
      monthly: (ym) => ({ you: ym >= ymOf(2026, 0) ? 2000 : ym >= ymOf(2024, 0) ? 1800 : 1500, employer: ym >= ymOf(2024, 0) ? 900 : 750 }),
      label: (t, who) => `${FUNDS[t].name} - Contributions - ${who === "you" ? "Employee Deferral" : "Employer Match"}` },
    { id: "r-roth", startBal: 14_500, mix: { VTSAX: 0.7, VTIAX: 0.3 }, costBasis: false,
      monthly: (ym) => ({ you: ym % 12 === 0 ? (Math.floor(ym / 12) >= 2026 ? 7500 : 7000) : 0, employer: 0 }),
      label: (t) => `Contribution ${Math.floor(now / 12)} - ${t}` },
    { id: "r-rollover", startBal: 36_000, mix: { SWPPX: 1 }, costBasis: false, monthly: () => ({ you: 0, employer: 0 }), label: () => "" },
    { id: "b-schwab", startBal: 12_000, mix: { VTI: 0.6, VXUS: 0.25, AAPL: 0.15 }, costBasis: true,
      monthly: (ym) => ({ you: ym % 12 === 6 ? 0 : 1200, employer: 0 }), label: (t) => `Bought ${t}` },
  ];
  for (const p of plans) {
    const shares: Record<string, number> = {}, paid: Record<string, number> = {};
    for (const [t, w] of Object.entries(p.mix)) { shares[t] = (p.startBal * w) / px(t, start); paid[t] = p.startBal * w; }
    for (let ym = start; ym <= now; ym++) {
      const c = p.monthly(ym);
      for (const [t, w] of Object.entries(p.mix)) {
        for (const who of ["you", "employer"] as const) {
          const amt = c[who] * w;
          if (!amt) continue;
          const q = amt / px(t, ym);
          shares[t] += q; paid[t] += amt;
          // Plaid gives about two years of investment transactions.
          const d = dateIn(ym, 15);
          if (d && ym >= now - 23) itx(p.id, d, "buy", p.id.startsWith("r-") ? "contribution" : "buy", p.label(t, who), t, q, px(t, ym));
        }
      }
      snap(p.id, ym, Object.keys(p.mix).reduce((s, t) => s + shares[t] * px(t, ym), 0));
    }
    for (const t of Object.keys(p.mix)) {
      holdings.push({ account_id: p.id, as_of: todayIso, security_id: `s-${t}`, ticker: t, name: FUNDS[t].name, security_type: t === "AAPL" ? "equity" : "mutual fund",
        quantity: Math.round(shares[t] * 1e4) / 1e4, price: px(t, now), value: r2(shares[t] * px(t, now)), cost_basis: p.costBasis ? r2(paid[t]) : null });
    }
    if (p.id === "b-schwab") holdings.push({ account_id: p.id, as_of: todayIso, security_id: "s-cash", ticker: null, name: "Cash & sweep", security_type: "cash", quantity: 1840.22, price: 1, value: 1840.22, cost_basis: null });
  }

  // Stock plan: RSUs vest quarterly from Mar 2023 with shares sold to cover taxes; ESPP buys every May and Nov. The brokerage reports no cost for ESPP shares.
  let held = 0;
  for (let ym = ymOf(2023, 2); ym <= now; ym++) {
    const mo = ym % 12, d = dateIn(ym, 20), d2 = dateIn(ym, 22), p = px("LDGR", ym);
    if (mo % 3 === 2 && d) {
      held += 60; itx("b-stock", d, "transfer", "transfer", "RESTRICTED STOCK LAPSE", "LDGR", 60, p);
      if (d2) { held -= 23; itx("b-stock", d2, "sell", "sell", "SALE TO COVER TAXES", "LDGR", -23, r2(p * 1.01)); }
    }
    if ((mo === 4 || mo === 10) && d) { held += 38; itx("b-stock", d, "buy", "buy", "EMPLOYEE STOCK PURCHASE", "LDGR", 38, r2(p * 0.85)); }
    snap("b-stock", ym, held * p + (ym > ymOf(2023, 2) ? 212.4 : 0));
  }
  holdings.push({ account_id: "b-stock", as_of: todayIso, security_id: "s-LDGR", ticker: "LDGR", name: FUNDS.LDGR.name, security_type: "equity", quantity: held, price: px("LDGR", now), value: r2(held * px("LDGR", now)), cost_basis: null });
  holdings.push({ account_id: "b-stock", as_of: todayIso, security_id: "s-cash", ticker: null, name: "Cash", security_type: "cash", quantity: 212.4, price: 1, value: 212.4, cost_basis: null });

  // Cash accounts: smooth growth with a little monthly wobble. The Chase line is its members' sum.
  const rc = rng("cash");
  for (let ym = start; ym <= now; ym++) {
    const t = ym - start, w = () => (rc() - 0.5);
    snap("c-chk", ym, 7200 + 2500 * Math.sin(t / 2.3) + 1200 * w());
    snap("c-sav", ym, 18_000 + 260 * t + 600 * w());
    if (ym >= ymOf(2024, 3)) snap("c-trip", ym, Math.min(6000, 300 * (ym - ymOf(2024, 3)) + 400) - (ym >= now - 2 ? 2400 : 0));
    snap("c-ally", ym, 9_000 + 610 * t + 900 * w());
    if (ym >= now - 1) snap("c-venmo", ym, 46 + 120 * rc());
    if (ym >= now - 1) { snap("k-amex", ym, 1900 + 900 * rc()); snap("k-sapph", ym, 2600 + 1400 * rc()); }
  }
  void mkt;

  const { transactions, splits, owed } = buildTransactions(today);
  const categories: Row[] = CATEGORIES.map(([name, color, sort], i) => ({ name, color, sort, is_project: i === CATEGORIES.length - 1, started_on: null, finished_on: null, created_at: "2025-01-04T12:00:00Z" }));
  const trip = categories[categories.length - 1];
  trip.started_on = iso(new Date(Date.UTC(y, m - 3, 2)));
  const subcategories = Object.entries(SUBS).flatMap(([category, names]) => names.map((name, i) => ({ category, name, sort: i + 1 })));
  const category_rules = [
    ["netflix", "spend", "Subscriptions", "Streaming"], ["spotify", "spend", "Subscriptions", "Streaming"],
    ["lodestar robotics payroll", "income", null, null], ["avalonbay", "spend", "Housing & living", "Rent"],
  ].map(([match, kind, category, subcategory], i) => ({ id: i + 1, match, kind, category, subcategory, created_at: "2025-01-04T12:00:00Z" }));

  return {
    key: `${y}-${String(m + 1).padStart(2, "0")}`,
    prices,
    tables: {
      plaid_items: items, accounts, balance_snapshots: snaps, holdings, investment_transactions: invTx,
      transactions, transaction_splits: splits, owed, categories, subcategories, category_rules, manual_cost: [],
    },
  };
}

// ---- Spending ----

const CATEGORIES: [string, string, number][] = [
  ["Housing & living", "g1", 1], ["Groceries", "g2", 2], ["Dining", "g3", 3], ["Getting around", "g7", 4], ["Shopping", "g5", 5],
  ["Subscriptions", "g4", 6], ["Health & fitness", "g10", 7], ["Fun", "g6", 8], ["Travel", "g8", 9], ["Gifts & giving", "g9", 10],
  ["Fees & services", "g11", 11], ["Other", "g11", 12], ["Japan trip", "g12", 20],
];
const SUBS: Record<string, string[]> = {
  "Housing & living": ["Rent", "Utilities", "Internet", "Renters insurance"],
  Dining: ["Restaurants", "Delivery", "Coffee"],
  "Getting around": ["Metro & transit", "Rideshare", "Gas", "Parking"],
  Shopping: ["Household", "Personal care", "Clothes", "Other"],
  Subscriptions: ["Streaming", "Software & apps"],
  "Health & fitness": ["Gym", "Medical & pharmacy"],
  Fun: ["Events & tickets", "Movies", "Games", "Books"],
  Travel: ["Flights", "Lodging"],
  "Fees & services": ["Fees & taxes", "Services"],
  "Japan trip": ["Flights", "Lodging", "Food", "Activities"],
};

type Pick = [merchant: string, name: string, lo: number, hi: number, cat: string, sub: string | null, acct: string];
const DINING: Pick[] = [
  ["Sweetgreen", "SWEETGREEN BROADWAY", 14, 19, "Dining", "Restaurants", "k-amex"],
  ["Blue Bottle Coffee", "SQ *BLUE BOTTLE COFFEE", 5, 8, "Dining", "Coffee", "k-amex"],
  ["Joe Coffee", "TST* JOE COFFEE", 4, 7, "Dining", "Coffee", "k-amex"],
  ["Los Tacos No. 1", "TST* LOS TACOS NO 1", 16, 28, "Dining", "Restaurants", "k-amex"],
  ["Doordash", "DOORDASH*THAI VILLA", 28, 52, "Dining", "Delivery", "k-sapph"],
  ["Via Carota", "VIA CAROTA", 70, 140, "Dining", "Restaurants", "k-sapph"],
];
const GROCERY: Pick[] = [
  ["Whole Foods", "WHOLEFDS MKT 10234", 45, 140, "Groceries", null, "k-amex"],
  ["Trader Joe's", "TRADER JOE S #558", 30, 85, "Groceries", null, "k-amex"],
];
const ERRANDS: Pick[] = [
  ["Uber", "UBER *TRIP", 11, 34, "Getting around", "Rideshare", "k-sapph"],
  ["MTA", "MTA*NYCT PAYGO", 34, 34, "Getting around", "Metro & transit", "k-sapph"],
  ["Amazon", "AMAZON MKTPL*2K4", 12, 95, "Shopping", "Household", "k-sapph"],
  ["Target", "TARGET 00012", 20, 75, "Shopping", "Household", "k-amex"],
  ["Uniqlo", "UNIQLO SOHO", 40, 120, "Shopping", "Clothes", "k-sapph"],
  ["CVS", "CVS/PHARMACY #0187", 9, 40, "Health & fitness", "Medical & pharmacy", "k-amex"],
  ["AMC", "AMC 34TH ST 14", 18, 36, "Fun", "Movies", "k-sapph"],
  ["Ticketmaster", "TICKETMASTER", 60, 180, "Fun", "Events & tickets", "k-sapph"],
  ["Steam", "STEAMGAMES.COM", 10, 60, "Fun", "Games", "k-sapph"],
];

function buildTransactions(today: Date) {
  const transactions: Row[] = [], splits: Row[] = [], owed: Row[] = [];
  const todayIso = iso(today);
  const day0 = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 13, 1));
  let splitId = 0, owedId = 0;

  for (let d = new Date(day0); iso(d) <= todayIso; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = iso(d), r = rng("day:" + date), dom = d.getUTCDate(), dow = d.getUTCDay(), mo = d.getUTCMonth();
    const ym = d.getUTCFullYear() * 12 + mo;
    let n = 0;
    const add = (account_id: string, amount: number, name: string, merchant: string | null, kind: string, category: string | null, sub: string | null, extra: Row = {}) => {
      const row: Row = {
        id: `t-${date.replaceAll("-", "")}-${++n}`, account_id, date, amount: r2(amount), name, merchant_name: merchant,
        plaid_category: null, plaid_category_detailed: null, pending: date >= iso(new Date(today.getTime() - 864e5)) && kind === "spend",
        kind, category, subcategory: sub, category_source: kind === "spend" ? "plaid" : "rule", confidence: 1, needs_review: false,
        note: null, payback: false, created_at: date + "T12:00:00Z", ...extra,
      };
      transactions.push(row);
      return row;
    };
    const pick = (list: Pick[]) => {
      const [merchant, name, lo, hi, cat, sub, acct] = list[Math.floor(r() * list.length)];
      return add(acct, lo + (hi - lo) * r(), name, merchant, "spend", cat, sub);
    };
    // A pair of rows for money moving between your own accounts.
    const move = (from: string, to: string, amount: number, outName: string, inName: string) => {
      add(from, amount, outName, null, "transfer", null, null);
      add(to, -amount, inName, null, "transfer", null, null);
    };

    // Paychecks every other Friday, rent on the 1st, bills through the month.
    const weeks = Math.floor((Date.parse(date) - Date.UTC(2025, 0, 3)) / (7 * 864e5));
    if (dow === 5 && weeks % 2 === 0) add("c-chk", -(3480 + (ym >= today.getUTCFullYear() * 12 ? 140 : 0)), "LODESTAR ROBOTICS PAYROLL PPD", "Lodestar Robotics", "income", null, null);
    if (dom === 1) add("c-chk", 2850, "AVALONBAY COMMUNITIES WEB PMT", "AvalonBay", "spend", "Housing & living", "Rent", { category_source: "rule" });
    if (dom === 2) move("c-chk", "c-ally", 1000, "ONLINE TRANSFER TO ALLY BANK", "TRANSFER FROM CHASE");
    if (dom === 3) add("k-sapph", 52, "EQUINOX SPORTSCLUB", "Equinox", "spend", "Health & fitness", "Gym");
    if (dom === 8) add("k-sapph", 17.99, "NETFLIX.COM", "Netflix", "spend", "Subscriptions", "Streaming", { category_source: "rule" });
    if (dom === 12) add("k-sapph", 11.99, "SPOTIFY USA", "Spotify", "spend", "Subscriptions", "Streaming", { category_source: "rule" });
    if (dom === 14) add("k-sapph", 20, "CLAUDE.AI SUBSCRIPTION", "Anthropic", "spend", "Subscriptions", "Software & apps");
    if (dom === 16) add("c-chk", 64 + 70 * r() + (mo >= 5 && mo <= 7 ? 60 : 0), "CON ED OF NY PAYMENT", "Con Edison", "spend", "Housing & living", "Utilities");
    if (dom === 20) add("c-chk", 70, "VERIZON FIOS", "Verizon", "spend", "Housing & living", "Internet");
    if (dom === 28) add("c-ally", -(95 + 3 * (ym % 24)), "INTEREST PAID", null, "income", null, null);
    if (dom === 22) {
      const amex = r2(900 + 700 * r()), sapph = r2(1100 + 900 * r());
      move("c-chk", "k-amex", amex, "AMEX EPAYMENT ACH PMT", "PAYMENT RECEIVED - THANK YOU");
      move("c-chk", "k-sapph", sapph, "CHASE CREDIT CRD AUTOPAY", "AUTOMATIC PAYMENT - THANK");
    }
    if (dom === 5) move("c-chk", "c-trip", 300, "TRANSFER TO SAV ...1187", "TRANSFER FROM CHK ...4821");

    // Everyday spending.
    if (r() < 0.62) pick(DINING);
    if (r() < 0.3) pick(DINING);
    if (r() < 0.24) pick(GROCERY);
    if (r() < 0.35) pick(ERRANDS);
    if (dow === 6 && r() < 0.5) add("k-amex", 120 + 140 * r(), "COSTCO WHSE #0213", "Costco", "spend", "Groceries", null);
  }

  // A few transactions picked out so every feature has something to show.
  const byDays = (ago: number) => iso(new Date(today.getTime() - ago * 864e5));
  const special = (ago: number, row: Row) => {
    const date = byDays(ago);
    const t: Row = {
      id: `t-${date.replaceAll("-", "")}-x${transactions.length}`, date, pending: false, plaid_category: null, plaid_category_detailed: null,
      category_source: "user", confidence: 1, needs_review: false, note: null, payback: false, created_at: date + "T12:00:00Z", merchant_name: null, ...row,
    };
    transactions.push(t);
    return t;
  };
  // Japan trip: a project, with the Airbnb split with a friend who still owes their half.
  special(80, { account_id: "k-sapph", amount: 1462.4, name: "JAPAN AIRLINES 1312", merchant_name: "Japan Airlines", kind: "spend", category: "Japan trip", subcategory: "Flights" });
  const bnb = special(74, { account_id: "k-sapph", amount: 1180, name: "AIRBNB * HMZ8Q2", merchant_name: "Airbnb", kind: "spend", category: "Japan trip", subcategory: "Lodging", note: "Kyoto, split with Jordan" });
  owed.push({ id: ++owedId, transaction_id: bnb.id, person: "Jordan", amount: 590, status: "waiting", sort: 0, created_at: bnb.created_at });
  special(40, { account_id: "k-sapph", amount: 312.6, name: "JR EAST TRAVEL SERVICE", merchant_name: "JR East", kind: "spend", category: "Japan trip", subcategory: "Activities" });
  special(38, { account_id: "k-sapph", amount: 96.2, name: "ICHIRAN SHIBUYA", merchant_name: "Ichiran", kind: "spend", category: "Japan trip", subcategory: "Food" });
  // Dinner for three: one friend paid back through Venmo, one hasn't.
  const dinner = special(19, { account_id: "k-sapph", amount: 246, name: "TST* CARBONE NEW YORK", merchant_name: "Carbone", kind: "spend", category: "Dining", subcategory: "Restaurants" });
  owed.push({ id: ++owedId, transaction_id: dinner.id, person: "Priya", amount: 82, status: "paid", sort: 0, created_at: dinner.created_at });
  owed.push({ id: ++owedId, transaction_id: dinner.id, person: "Leo", amount: 82, status: "waiting", sort: 1, created_at: dinner.created_at });
  special(17, { account_id: "c-venmo", amount: -82, name: 'Priya Shah "carbone 🍝"', kind: "income", category: null, subcategory: null, payback: true });
  special(25, { account_id: "c-venmo", amount: 64, name: 'Sam Ortiz "concert tix 🎶"', kind: "spend", category: "Fun", subcategory: "Events & tickets" });
  special(9, { account_id: "c-venmo", amount: 36, name: 'Maya Chen "birthday gift 🎁"', kind: "spend", category: "Gifts & giving", subcategory: null });
  // A Costco run split between groceries and household.
  const costco = special(11, { account_id: "k-amex", amount: 214.37, name: "COSTCO WHSE #0213", merchant_name: "Costco", kind: "spend", category: "Groceries", subcategory: null });
  splits.push({ id: ++splitId, transaction_id: costco.id, category: "Groceries", subcategory: null, amount: 138.12, sort: 0 });
  splits.push({ id: ++splitId, transaction_id: costco.id, category: "Shopping", subcategory: "Household", amount: 76.25, sort: 1 });
  // Ones the auto-categorizer wasn't sure about, waiting for a look.
  special(4, { account_id: "k-amex", amount: 42.8, name: "SQ *UNION SQ GREENMARKET", merchant_name: "Union Square Greenmarket", kind: "spend", category: "Shopping", subcategory: "Other", category_source: "ai", confidence: 0.55, needs_review: true });
  special(6, { account_id: "k-sapph", amount: 129, name: "PAYPAL *ETSY 4029357733", merchant_name: "Etsy", kind: "spend", category: "Shopping", subcategory: "Other", category_source: "ai", confidence: 0.5, needs_review: true });
  special(3, { account_id: "c-chk", amount: -250, name: "ZELLE FROM ALEX KIM", merchant_name: null, kind: "income", category: null, subcategory: null, category_source: "ai", confidence: 0.45, needs_review: true });

  return { transactions, splits, owed };
}
