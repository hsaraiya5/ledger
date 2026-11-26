import { ConnectionsView } from "@/components/ConnectionsView";
import { requireOwner } from "@/lib/auth";
import { plaidEnv } from "@/lib/plaid";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Connections · Ledger" };

export default async function ConnectionsPage() {
  await requireOwner();
  const db = createAdminClient();
  const [items, accounts] = await Promise.all([
    db.from("plaid_items").select("id, institution_name, products, status, last_error, last_synced_at").order("created_at"),
    db.from("accounts").select("id, name, institution, bucket, mask, plaid_item_id, hidden, data_source, parent_id, nickname, kept_separate").order("sort_order"),
  ]);
  if (items.error) throw items.error;
  if (accounts.error) throw accounts.error;
  return <ConnectionsView items={items.data} accounts={accounts.data} env={plaidEnv} />;
}
