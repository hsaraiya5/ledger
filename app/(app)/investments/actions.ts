"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/** Save (or with null, clear) what you paid per share for a holding the brokerage reports no cost basis for. */
export async function setManualCost(accountId: string, ticker: string, perShare: number | null) {
  await requireOwner();
  const db = createAdminClient();
  if (perShare === null) {
    const { error } = await db.from("manual_cost").delete().eq("account_id", accountId).eq("ticker", ticker);
    if (error) throw error;
  } else {
    if (!(perShare > 0) || !Number.isFinite(perShare)) throw new Error("Enter a price above $0.");
    const { error } = await db.from("manual_cost").upsert({ account_id: accountId, ticker, per_share: perShare, updated_at: new Date().toISOString() });
    if (error) throw error;
  }
  revalidatePath("/investments", "layout");
}
