import "server-only";
import { requireOwner } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { normalizeCategory, type Cat, type Kind } from "@/lib/categories";
import { ymFromDate, type Account, type Ledger, type Snapshot } from "@/lib/ledger";

export type Member = { id: string; name: string; nickname: string | null; separate: boolean; mask: string | null; balance: number | null; asOf: string | null };

export async function getLedger(): Promise<Ledger & { members: Record<string, Member[]> }> {
  const supabase = await createClient();
  const [accountsRes, balancesRes] = await Promise.all([
    // Credit cards are tracked for spending, not net worth (matching the sheet).
    supabase.from("accounts").select("id, name, institution, bucket, tax_treatment, data_source, parent_id, mask, nickname, kept_separate")
      .eq("hidden", false).neq("bucket", "credit").order("sort_order"),
    supabase.from("balance_snapshots").select("account_id, as_of, balance").order("as_of"),
  ]);
  if (accountsRes.error) throw accountsRes.error;
  if (balancesRes.error) throw balancesRes.error;

  // Top-level accounts are the sheet lines; accounts with a parent roll up into it.
  const accounts: Account[] = accountsRes.data.filter((a) => !a.parent_id).map((a) => ({
    id: a.id,
    name: a.name,
    institution: a.institution,
    bucket: a.bucket,
    taxTreatment: a.tax_treatment,
    nickname: a.nickname,
    dataSource: a.data_source,
  }));
  const parentOf = new Map<string, string>(accountsRes.data.filter((a) => a.parent_id).map((a) => [a.id, a.parent_id]));
  const visible = new Set(accountsRes.data.map((a) => a.id));

  // Latest balance per account per month (rows are date-ordered, so later rows win).
  const perAccount = new Map<number, Map<string, number>>();
  const latest = new Map<string, { balance: number; asOf: string }>();
  for (const b of balancesRes.data) {
    if (!visible.has(b.account_id)) continue;
    const ym = ymFromDate(b.as_of);
    const m = perAccount.get(ym) ?? new Map<string, number>();
    m.set(b.account_id, Number(b.balance));
    perAccount.set(ym, m);
    latest.set(b.account_id, { balance: Number(b.balance), asOf: b.as_of });
  }

  // A group uses the sum of its members in months where any member has a balance; otherwise its own sheet value.
  const snaps: Snapshot[] = [...perAccount.entries()].sort((a, b) => a[0] - b[0]).map(([ym, m]) => {
    const v: Record<string, number> = {};
    const memberSums = new Map<string, number>();
    for (const [id, bal] of m) {
      const parent = parentOf.get(id);
      if (parent) memberSums.set(parent, (memberSums.get(parent) ?? 0) + bal);
      else v[id] = bal;
    }
    for (const [parent, sum] of memberSums) v[parent] = sum;
    return { ym, v };
  });

  const members: Record<string, Member[]> = {};
  for (const a of accountsRes.data.filter((x) => x.parent_id)) {
    const l = latest.get(a.id);
    (members[a.parent_id] ??= []).push({ id: a.id, name: a.name, nickname: a.nickname, separate: a.kept_separate, mask: a.mask, balance: l?.balance ?? null, asOf: l?.asOf ?? null });
  }

  return { accounts, snaps, members };
}

export type Holding = { ticker: string | null; name: string; quantity: number; price: number | null; value: number; costBasis: number | null };

/** The most recent holdings snapshot across one or more accounts (a group's members). */
export async function getHoldings(accountIds: string[]): Promise<{ asOf: string | null; holdings: Holding[] }> {
  const supabase = await createClient();
  const { data: latest } = await supabase.from("holdings").select("as_of").in("account_id", accountIds)
    .order("as_of", { ascending: false }).limit(1).maybeSingle();
  if (!latest) return { asOf: null, holdings: [] };
  const { data, error } = await supabase.from("holdings").select("ticker, name, quantity, price, value, cost_basis")
    .in("account_id", accountIds).eq("as_of", latest.as_of).gt("value", 0).order("value", { ascending: false });
  if (error) throw error;
  return {
    asOf: latest.as_of,
    holdings: data.map((h) => ({ ticker: h.ticker, name: h.name, quantity: Number(h.quantity), price: h.price === null ? null : Number(h.price), value: Number(h.value), costBasis: h.cost_basis === null ? null : Number(h.cost_basis) })),
  };
}

export type Retirement = {
  /** Latest holdings per sheet line; missing = not linked yet. */
  holdings: Record<string, Holding[]>;
  /** Recorded contributions per sheet line per month (ym), split by who put the money in. */
  contrib: Record<string, Record<number, { you: number; employer: number }>>;
  /** First investment transaction date Plaid gave us per sheet line. */
  historyFrom: Record<string, string>;
  /** Net shares bought per sheet line per ticker, from the transactions Plaid gave us. */
  sharesBought: Record<string, Record<string, number>>;
};

export async function getRetirement(accountIds: string[]): Promise<Retirement> {
  const supabase = await createClient();
  const { data: acc, error } = await supabase.from("accounts").select("id, parent_id");
  if (error) throw error;
  const top = new Map(acc.map((a) => [a.id, a.parent_id ?? a.id]));
  const leaves = acc.filter((a) => accountIds.includes(top.get(a.id)!)).map((a) => a.id);

  const [hold, txns] = await Promise.all([
    Promise.all(accountIds.map(async (id) => [id, await getHoldings(leaves.filter((l) => top.get(l) === id))] as const)),
    supabase.from("investment_transactions").select("account_id, date, type, subtype, name, ticker, quantity, amount").in("account_id", leaves).order("date"),
  ]);
  if (txns.error) throw txns.error;

  const out: Retirement = { holdings: {}, contrib: {}, historyFrom: {}, sharesBought: {} };
  for (const [id, h] of hold) if (h.holdings.length) out.holdings[id] = h.holdings;
  for (const t of txns.data) {
    const line = top.get(t.account_id)!;
    out.historyFrom[line] ??= t.date;
    if ((t.type === "buy" || t.type === "sell") && t.ticker) {
      const b = (out.sharesBought[line] ??= {});
      b[t.ticker] = (b[t.ticker] ?? 0) + Number(t.quantity);
    }
    if (t.subtype !== "contribution") continue;
    const m = ((out.contrib[line] ??= {})[ymFromDate(t.date)] ??= { you: 0, employer: 0 });
    // Plan recordkeepers name the source, e.g. "Fidelity 500 Index - Contributions - Employer".
    m[/employer/i.test(t.name ?? "") ? "employer" : "you"] += Number(t.amount);
  }
  return out;
}

export type SyncStatus = {
  items: { institution: string; status: string; error: string | null; syncedAt: string | null }[];
  /** Accounts meant to come from Plaid that no linked login covers yet. */
  unlinked: { name: string; institution: string }[];
};

/** Owner only. Plaid logins hold access tokens, so only the admin client can read them; this selects no secrets. */
export async function getSyncStatus(): Promise<SyncStatus> {
  await requireOwner();
  const supabase = createAdminClient();
  const [items, accts] = await Promise.all([
    supabase.from("plaid_items").select("id, institution_name, status, last_error, last_synced_at").order("institution_name"),
    supabase.from("accounts").select("id, name, institution, parent_id, plaid_item_id, hidden, data_source"),
  ]);
  if (items.error) throw items.error;
  if (accts.error) throw accts.error;
  // A sheet line is covered if it, or one of its members, is linked.
  const covered = new Set(accts.data.filter((a) => a.plaid_item_id).flatMap((a) => [a.id, a.parent_id]));
  return {
    items: items.data.map((i) => ({ institution: i.institution_name ?? "Unknown", status: i.status, error: i.last_error, syncedAt: i.last_synced_at })),
    unlinked: accts.data.filter((a) => a.data_source === "plaid" && !a.parent_id && !a.hidden && !covered.has(a.id)).map((a) => ({ name: a.name, institution: a.institution })),
  };
}

export type Lot = Holding & {
  /** The account that holds it (a group's member, or the line itself). */
  leaf: string;
  leafLabel: string | null;
  cash: boolean;
  /** Per-share cost you entered by hand, where the brokerage reports none. */
  manualCost: number | null;
};
export type ShareEvent = { date: string; type: string; name: string; qty: number; price: number; amount: number };
export type Investments = {
  lots: Record<string, Lot[]>;
  /** Share changes per leaf account and ticker, oldest first. */
  events: Record<string, ShareEvent[]>;
};

export async function getInvestments(lineIds: string[]): Promise<Investments> {
  const supabase = await createClient();
  const { data: acc, error } = await supabase.from("accounts").select("id, parent_id, nickname");
  if (error) throw error;
  const top = new Map(acc.map((a) => [a.id, a.parent_id ?? a.id]));
  const leaves = acc.filter((a) => lineIds.includes(top.get(a.id)!));
  const ids = leaves.map((a) => a.id);
  const since = new Date(Date.now() - 10 * 864e5).toISOString().slice(0, 10);

  const [hold, txns, manual] = await Promise.all([
    supabase.from("holdings").select("account_id, as_of, ticker, name, security_type, quantity, price, value, cost_basis").in("account_id", ids).gte("as_of", since),
    supabase.from("investment_transactions").select("account_id, date, type, name, ticker, quantity, price, amount").in("account_id", ids).order("date"),
    supabase.from("manual_cost").select("account_id, ticker, per_share").in("account_id", ids),
  ]);
  if (hold.error) throw hold.error;
  if (txns.error) throw txns.error;
  if (manual.error) throw manual.error;

  const latest = new Map<string, string>();
  for (const h of hold.data) if (h.as_of > (latest.get(h.account_id) ?? "")) latest.set(h.account_id, h.as_of);
  const cost = new Map(manual.data.map((m) => [`${m.account_id}|${m.ticker}`, Number(m.per_share)]));
  const label = new Map(leaves.map((a) => [a.id, a.nickname as string | null]));

  const out: Investments = { lots: {}, events: {} };
  for (const h of hold.data) {
    if (h.as_of !== latest.get(h.account_id) || Number(h.value) <= 0) continue;
    (out.lots[top.get(h.account_id)!] ??= []).push({
      leaf: h.account_id, leafLabel: label.get(h.account_id) ?? null, cash: h.security_type === "cash",
      ticker: h.ticker, name: h.name, quantity: Number(h.quantity), price: h.price === null ? null : Number(h.price),
      value: Number(h.value), costBasis: h.cost_basis === null ? null : Number(h.cost_basis),
      manualCost: h.ticker ? cost.get(`${h.account_id}|${h.ticker}`) ?? null : null,
    });
  }
  for (const lots of Object.values(out.lots)) lots.sort((a, b) => Number(a.cash) - Number(b.cash) || b.value - a.value);
  for (const t of txns.data) {
    if (!t.ticker || !Number(t.quantity)) continue;
    (out.events[`${t.account_id}|${t.ticker}`] ??= []).push({ date: t.date, type: t.type, name: t.name ?? "", qty: Number(t.quantity), price: Number(t.price ?? 0), amount: Number(t.amount) });
  }
  return out;
}

export type Txn = {
  id: string;
  date: string;
  /** Positive = money out, negative = money in (Plaid's convention). */
  amount: number;
  merchant: string;
  name: string;
  /** The note a payment app (Venmo) carries, e.g. "Travel 🧳". */
  memo: string | null;
  accountId: string;
  kind: Kind | null;
  category: string | null;
  sub: string | null;
  note: string | null;
  payback: boolean;
  source: string | null;
  confidence: number | null;
  needsReview: boolean;
  pending: boolean;
  /** The other half of a move between your own accounts, when both halves are here. */
  pairId: string | null;
};
export type SpendAccount = { id: string; label: string; fullName: string; bucket: string; separate: boolean; balance: number | null };
export type Split = { category: string; sub: string | null; amount: number };
export type Owe = { id: number; person: string; amount: number; status: "waiting" | "paid" | "gone" };
export type Spending = {
  txns: Txn[];
  /** Purchases older than the loaded range that someone still owes you for. */
  olderOwed: Txn[];
  accounts: SpendAccount[];
  categories: Cat[];
  splits: Record<string, Split[]>;
  owed: Record<string, Owe[]>;
};

const TXN_COLS = "id, account_id, date, amount, name, merchant_name, kind, category, subcategory, note, payback, category_source, confidence, needs_review, pending";
type TxnRow = {
  id: string; account_id: string; date: string; amount: number; name: string; merchant_name: string | null; kind: Kind | null;
  category: string | null; subcategory: string | null; note: string | null; payback: boolean; category_source: string | null;
  confidence: number | null; needs_review: boolean; pending: boolean;
};
// Venmo rows come from Plaid as: Person Name "note".
const memoOf = (name: string) => name.match(/^(.+?)\s+"([^]*)"\s*$/);
const toTxn = (r: TxnRow): Txn => ({
  id: r.id, date: r.date, amount: Number(r.amount), name: r.name,
  merchant: r.merchant_name ?? memoOf(r.name)?.[1] ?? cleanName(r.name), memo: memoOf(r.name)?.[2] || null,
  accountId: r.account_id, kind: r.kind, category: normalizeCategory(r.category), sub: r.subcategory, note: r.note,
  payback: r.payback, source: r.category_source, confidence: r.confidence === null ? null : Number(r.confidence),
  needsReview: r.needs_review, pending: r.pending, pairId: null,
});

/** Match the two halves of each move between your own accounts: same amount, opposite sign, within 5 days. */
function pairTransfers(txns: Txn[]) {
  const ins = txns.filter((t) => t.kind === "transfer" && t.amount < 0);
  for (const out of txns.filter((t) => t.kind === "transfer" && t.amount > 0)) {
    let best: Txn | null = null, gap = Infinity;
    for (const i of ins) {
      if (i.pairId || i.accountId === out.accountId || Math.abs(i.amount + out.amount) > 0.005) continue;
      const d = Math.abs(Date.parse(i.date) - Date.parse(out.date)) / 864e5;
      if (d <= 5 && d < gap) { best = i; gap = d; }
    }
    if (best) { best.pairId = out.id; out.pairId = best.id; }
  }
}

/** Everything the Spending page needs: ~13 months of transactions from checking, savings, cards and Venmo. */
export async function getSpending(): Promise<Spending> {
  const supabase = await createClient();
  const from = new Date();
  from.setMonth(from.getMonth() - 13, 1);
  const [txRes, accRes, balRes, catRes, subRes, splitRes, owedRes] = await Promise.all([
    supabase.from("transactions").select(`${TXN_COLS}, accounts!inner(hidden, bucket)`)
      .eq("accounts.hidden", false).in("accounts.bucket", ["cash", "credit"])
      .gte("date", from.toISOString().slice(0, 10)).order("date", { ascending: false }).limit(5000),
    supabase.from("accounts").select("id, name, institution, nickname, bucket, kept_separate, hidden").order("sort_order"),
    supabase.from("balance_snapshots").select("account_id, as_of, balance").gte("as_of", new Date(Date.now() - 40 * 864e5).toISOString().slice(0, 10)).order("as_of"),
    supabase.from("categories").select("name, is_project, color, sort, started_on, finished_on").order("sort"),
    supabase.from("subcategories").select("category, name").order("sort"),
    supabase.from("transaction_splits").select("transaction_id, category, subcategory, amount").order("sort"),
    supabase.from("owed").select("id, transaction_id, person, amount, status").order("sort"),
  ]);
  for (const r of [txRes, accRes, balRes, catRes, subRes, splitRes, owedRes]) if (r.error) throw r.error;

  const txns = txRes.data!.map((r) => toTxn(r as unknown as TxnRow));
  pairTransfers(txns);

  const owed: Record<string, Owe[]> = {};
  for (const o of owedRes.data!) (owed[o.transaction_id] ??= []).push({ id: o.id, person: o.person, amount: Number(o.amount), status: o.status });
  const loaded = new Set(txns.map((t) => t.id));
  const missing = Object.keys(owed).filter((id) => !loaded.has(id));
  let olderOwed: Txn[] = [];
  if (missing.length) {
    const { data, error } = await supabase.from("transactions").select(TXN_COLS).in("id", missing);
    if (error) throw error;
    olderOwed = data.map((r) => toTxn(r as unknown as TxnRow));
  }

  const splits: Record<string, Split[]> = {};
  for (const s of splitRes.data!) (splits[s.transaction_id] ??= []).push({ category: normalizeCategory(s.category)!, sub: s.subcategory, amount: Number(s.amount) });

  const latest = new Map<string, number>();
  for (const b of balRes.data!) latest.set(b.account_id, Number(b.balance));
  const used = new Set(txns.map((t) => t.accountId));
  const accounts: SpendAccount[] = accRes.data!.filter((a) => used.has(a.id)).map((a) => ({
    id: a.id, label: a.nickname ?? `${a.institution} ${a.name}`, fullName: `${a.institution} ${a.name}`,
    bucket: a.bucket, separate: a.kept_separate, balance: latest.get(a.id) ?? null,
  }));
  // Tabs: bank accounts, then cards, then Venmo, then anything kept separate.
  const rank = (a: SpendAccount) => (a.separate ? 3 : /venmo/i.test(a.fullName) ? 2 : a.bucket === "credit" ? 1 : 0);
  accounts.sort((x, y) => rank(x) - rank(y));

  const categories: Cat[] = catRes.data!.map((c) => ({
    name: c.name, isProject: c.is_project, color: c.color, sort: c.sort, startedOn: c.started_on, finishedOn: c.finished_on,
    subs: subRes.data!.filter((s) => s.category === c.name).map((s) => s.name),
  }));
  return { txns, olderOwed, accounts, categories, splits, owed };
}

/** "TST* MAYDAN" → "Maydan", "SQ *BLUE BOTTLE CO" → "Blue Bottle Co". */
function cleanName(name: string) {
  const s = name.replace(/^(tst\*|sq \*|sq\*|ett\*|pp\*|py \*)\s*/i, "").replace(/\s{2,}.*$/, "").trim();
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
