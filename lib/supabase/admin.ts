import "server-only";
import { createClient } from "@supabase/supabase-js";
import { demoClient } from "@/lib/demo/db";
import { DEMO } from "@/lib/demo/mode";

/** Bypasses RLS. Only for the Plaid sync and owner-checked server actions. */
export function createAdminClient() {
  if (DEMO) return demoClient() as unknown as ReturnType<typeof realClient>;
  return realClient();
}

function realClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
