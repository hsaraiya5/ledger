import "server-only";
import type { AccountBase } from "plaid";
import { categorizePending } from "@/lib/categorize";
import { decrypt } from "@/lib/crypto";
import { plaid, plaidError } from "@/lib/plaid";
import { createAdminClient } from "@/lib/supabase/admin";

type Item = { id: string; products: string[]; access_token_enc: string; transactions_cursor: string | null; last_synced_at: string | null };
type Db = ReturnType<typeof createAdminClient>;

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Guess a bucket for a newly linked account; the owner can change it on the Connections page. */
export function guessBucket(a: AccountBase) {
  if (a.type === "credit" || a.type === "loan") return "credit";
  if (a.type === "investment") {
    const s = String(a.subtype ?? "");
    return /401|403|457|ira|roth|retirement|pension|sep|simple|keogh|tsp/i.test(s) ? "retirement" : "brokerage";
  }
  return "cash";
}

/** Our account ids keyed by Plaid account_id, for one item. */
async function accountMap(db: Db, itemId: string) {
  const { data, error } = await db.from("accounts").select("id, plaid_account_id").eq("plaid_item_id", itemId);
  if (error) throw error;
  return new Map(data.map((a) => [a.plaid_account_id as string, a.id as string]));
}

async function syncBalances(db: Db, token: string, ids: Map<string, string>, today: string) {
  const { data } = await plaid.accountsGet({ access_token: token });
  const rows = data.accounts
    .filter((a) => ids.has(a.account_id) && a.balances.current !== null)
    .map((a) => ({ account_id: ids.get(a.account_id)!, as_of: today, balance: a.balances.current!, source: "plaid" }));
  if (rows.length) {
    const { error } = await db.from("balance_snapshots").upsert(rows);
    if (error) throw error;
  }
}

async function syncInvestments(db: Db, item: Item, token: string, ids: Map<string, string>, today: string) {
  const { data } = await plaid.investmentsHoldingsGet({ access_token: token });
  const securities = new Map(data.securities.map((s) => [s.security_id, s]));
  const holdings = data.holdings
    .filter((h) => ids.has(h.account_id))
    .map((h) => {
      const s = securities.get(h.security_id);
      return {
        account_id: ids.get(h.account_id)!,
        as_of: today,
        security_id: h.security_id,
        ticker: s?.ticker_symbol ?? null,
        name: s?.name ?? "Unknown security",
        security_type: s?.type ?? null,
        quantity: h.quantity,
        price: h.institution_price,
        value: h.institution_value,
        cost_basis: h.cost_basis,
      };
    });
  await db.from("holdings").delete().eq("as_of", today).in("account_id", [...ids.values()]);
  if (holdings.length) {
    const { error } = await db.from("holdings").insert(holdings);
    if (error) throw error;
  }

  // Until we have history, pull 24 months; after that re-read the last month to catch late postings.
  const { count } = await db.from("investment_transactions").select("id", { count: "exact", head: true }).in("account_id", [...ids.values()]);
  const start = new Date();
  start.setMonth(start.getMonth() - (count ? 1 : 24));
  for (let offset = 0; ; ) {
    let page;
    try {
      ({ data: page } = await plaid.investmentsTransactionsGet({
        access_token: token,
        start_date: isoDay(start),
        end_date: today,
        options: { offset, count: 500 },
      }));
    } catch (e) {
      // Right after linking, Plaid is still pulling history; the next sync picks it up.
      if (plaidError(e).code === "PRODUCT_NOT_READY") return;
      throw e;
    }
    const secs = new Map(page.securities.map((s) => [s.security_id, s]));
    const rows = page.investment_transactions
      .filter((t) => ids.has(t.account_id))
      .map((t) => ({
        id: t.investment_transaction_id,
        account_id: ids.get(t.account_id)!,
        date: t.date,
        type: t.type,
        subtype: t.subtype,
        name: t.name,
        ticker: t.security_id ? secs.get(t.security_id)?.ticker_symbol ?? null : null,
        quantity: t.quantity,
        price: t.price,
        amount: t.amount,
      }));
    if (rows.length) {
      const { error } = await db.from("investment_transactions").upsert(rows);
      if (error) throw error;
    }
    offset += page.investment_transactions.length;
    if (!page.investment_transactions.length || offset >= page.total_investment_transactions) break;
  }
}

async function syncTransactions(db: Db, item: Item, token: string, ids: Map<string, string>) {
  let cursor = item.transactions_cursor ?? undefined;
  for (;;) {
    const { data } = await plaid.transactionsSync({ access_token: token, cursor, count: 500 });
    const rows = [...data.added, ...data.modified]
      .filter((t) => ids.has(t.account_id))
      .map((t) => ({
        id: t.transaction_id,
        account_id: ids.get(t.account_id)!,
        date: t.date,
        amount: t.amount,
        name: t.name,
        merchant_name: t.merchant_name ?? null,
        plaid_category: t.personal_finance_category?.primary ?? null,
        plaid_category_detailed: t.personal_finance_category?.detailed ?? null,
        pending: t.pending,
      }));
    if (rows.length) {
      const { error } = await db.from("transactions").upsert(rows);
      if (error) throw error;
    }
    const removed = data.removed.map((r) => r.transaction_id).filter(Boolean) as string[];
    if (removed.length) await db.from("transactions").delete().in("id", removed);
    cursor = data.next_cursor;
    if (!data.has_more) break;
  }
  const { error } = await db.from("plaid_items").update({ transactions_cursor: cursor }).eq("id", item.id);
  if (error) throw error;
}

export type SyncResult = { itemId: string; ok: boolean; message?: string };

export async function syncItem(itemId: string): Promise<SyncResult> {
  const db = createAdminClient();
  const { data: item, error } = await db.from("plaid_items")
    .select("id, products, access_token_enc, transactions_cursor, last_synced_at").eq("id", itemId).single();
  if (error) throw error;

  const today = isoDay(new Date());
  const token = decrypt(item.access_token_enc);
  try {
    const ids = await accountMap(db, item.id);
    await syncBalances(db, token, ids, today);
    if (item.products.includes("investments")) await syncInvestments(db, item, token, ids, today);
    if (item.products.includes("transactions")) await syncTransactions(db, item, token, ids);
    await db.from("plaid_items").update({ status: "ok", last_error: null, last_synced_at: new Date().toISOString() }).eq("id", item.id);
    return { itemId, ok: true };
  } catch (e) {
    const { code, message } = plaidError(e);
    const status = code === "ITEM_LOGIN_REQUIRED" ? "needs_login" : "error";
    await db.from("plaid_items").update({ status, last_error: `${code}: ${message}` }).eq("id", item.id);
    return { itemId, ok: false, message: `${code}: ${message}` };
  }
}

export async function syncAll(): Promise<SyncResult[]> {
  const db = createAdminClient();
  const { data, error } = await db.from("plaid_items").select("id");
  if (error) throw error;
  const results: SyncResult[] = [];
  for (const { id } of data) results.push(await syncItem(id));
  await categorizePending(db).catch((e) => console.error("Categorizing failed", e));
  return results;
}
