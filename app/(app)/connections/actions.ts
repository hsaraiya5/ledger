"use server";

import { revalidatePath } from "next/cache";
import { CountryCode, Products } from "plaid";
import { requireOwner } from "@/lib/auth";
import { DEMO } from "@/lib/demo/mode";
import { decrypt, encrypt } from "@/lib/crypto";
import { plaid, plaidError } from "@/lib/plaid";
import { createAdminClient } from "@/lib/supabase/admin";
import { guessBucket, syncAll, syncItem } from "@/lib/sync";

export type LinkKind = "bank" | "investment";

export async function createLinkToken(kind: LinkKind, updateItemId?: string) {
  const { userId } = await requireOwner();
  if (DEMO) return { error: "Linking a bank is turned off in the demo. In your own copy, this opens Plaid." };
  let accessToken: string | undefined;
  if (updateItemId) {
    const { data } = await createAdminClient().from("plaid_items").select("access_token_enc").eq("id", updateItemId).single();
    if (data) accessToken = decrypt(data.access_token_enc);
  }
  try {
    const { data } = await plaid.linkTokenCreate({
      user: { client_user_id: userId },
      client_name: "Ledger",
      language: "en",
      country_codes: [CountryCode.Us],
      // Update mode (re-login) takes the existing token and no products.
      ...(accessToken
        ? { access_token: accessToken }
        : { products: [kind === "bank" ? Products.Transactions : Products.Investments], transactions: { days_requested: 730 } }),
      ...(process.env.PLAID_REDIRECT_URI ? { redirect_uri: process.env.PLAID_REDIRECT_URI } : {}),
    });
    return { token: data.link_token };
  } catch (e) {
    return { error: plaidError(e).message };
  }
}

export async function exchangePublicToken(publicToken: string, kind: LinkKind, institutionName: string) {
  await requireOwner();
  if (DEMO) return { error: "Linking a bank is turned off in the demo." };
  const db = createAdminClient();
  try {
    const { data: ex } = await plaid.itemPublicTokenExchange({ public_token: publicToken });
    const { data: acc } = await plaid.accountsGet({ access_token: ex.access_token });

    const { error: itemErr } = await db.from("plaid_items").upsert({
      id: ex.item_id,
      institution_name: institutionName || "Unknown institution",
      products: [kind === "bank" ? "transactions" : "investments"],
      access_token_enc: encrypt(ex.access_token),
      status: "ok",
    });
    if (itemErr) throw itemErr;

    // Each Plaid account becomes its own row; matching it to an existing account happens on the Connections page.
    const rows = acc.accounts.map((a, i) => ({
      id: `p-${a.account_id.slice(0, 10).toLowerCase()}`,
      name: a.official_name || a.name,
      institution: institutionName || "Unknown",
      bucket: guessBucket(a),
      tax_treatment: a.subtype ? String(a.subtype) : String(a.type),
      data_source: "plaid",
      sort_order: 100 + i,
      plaid_item_id: ex.item_id,
      plaid_account_id: a.account_id,
      mask: a.mask,
    }));
    const { error: accErr } = await db.from("accounts").upsert(rows, { onConflict: "plaid_account_id" });
    if (accErr) throw accErr;

    await syncItem(ex.item_id);
    revalidatePath("/", "layout");
    return { ok: true as const };
  } catch (e) {
    return { error: plaidError(e).message };
  }
}

/** Fold a newly linked Plaid account into an existing account so its history continues. */
export async function mergeAccount(sourceId: string, targetId: string) {
  await requireOwner();
  const db = createAdminClient();
  const { data: src, error } = await db.from("accounts").select("plaid_item_id, plaid_account_id, mask").eq("id", sourceId).single();
  if (error) throw error;

  await db.from("accounts").update({ plaid_account_id: null }).eq("id", sourceId);
  const { error: tErr } = await db.from("accounts")
    .update({ plaid_item_id: src.plaid_item_id, plaid_account_id: src.plaid_account_id, mask: src.mask, data_source: "plaid" })
    .eq("id", targetId);
  if (tErr) throw tErr;

  const { data: snaps } = await db.from("balance_snapshots").select("as_of, balance, source").eq("account_id", sourceId);
  if (snaps?.length) await db.from("balance_snapshots").upsert(snaps.map((s) => ({ ...s, account_id: targetId })));
  for (const table of ["holdings", "investment_transactions", "transactions"] as const) {
    await db.from(table).update({ account_id: targetId }).eq("account_id", sourceId);
  }
  await db.from("accounts").delete().eq("id", sourceId);
  revalidatePath("/", "layout");
}

export async function updateAccount(id: string, patch: { bucket?: string; hidden?: boolean; name?: string; parent_id?: string | null; nickname?: string | null; kept_separate?: boolean }) {
  await requireOwner();
  const db = createAdminClient();
  // An account that counts toward a sheet line takes that line's bucket.
  if (patch.parent_id) {
    const { data: parent } = await db.from("accounts").select("bucket").eq("id", patch.parent_id).single();
    if (parent) patch.bucket = parent.bucket;
  }
  const { error } = await db.from("accounts").update(patch).eq("id", id);
  if (error) throw error;
  revalidatePath("/", "layout");
}

export async function syncNow() {
  await requireOwner();
  if (DEMO) return [];
  const results = await syncAll();
  revalidatePath("/", "layout");
  return results;
}

export async function removeItem(itemId: string) {
  await requireOwner();
  const db = createAdminClient();
  const { data } = await db.from("plaid_items").select("access_token_enc").eq("id", itemId).single();
  if (data && !DEMO) {
    // Stops Plaid billing for this login. Accounts and their history stay.
    await plaid.itemRemove({ access_token: decrypt(data.access_token_enc) }).catch(() => {});
  }
  await db.from("accounts").update({ plaid_account_id: null, data_source: "manual" }).eq("plaid_item_id", itemId);
  await db.from("plaid_items").delete().eq("id", itemId);
  revalidatePath("/", "layout");
}
