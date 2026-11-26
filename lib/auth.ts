import "server-only";
import { DEMO } from "@/lib/demo/mode";
import { createClient } from "@/lib/supabase/server";

/** Server actions are public endpoints, so each one re-checks that the caller is the owner. */
export async function requireOwner() {
  if (DEMO) return { userId: "demo" };
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims || claims.email !== process.env.ALLOWED_EMAIL) throw new Error("Not signed in");
  return { userId: claims.sub };
}
