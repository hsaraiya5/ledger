"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { TAX_KINDS } from "@/lib/ledger";
import { createAdminClient } from "@/lib/supabase/admin";

export async function setTaxTreatment(id: string, value: string) {
  await requireOwner();
  if (!(TAX_KINDS as readonly string[]).includes(value)) throw new Error(`Unknown tax treatment: ${value}`);
  const { error } = await createAdminClient().from("accounts").update({ tax_treatment: value }).eq("id", id).eq("bucket", "retirement");
  if (error) throw error;
  revalidatePath("/retirement", "layout");
}
