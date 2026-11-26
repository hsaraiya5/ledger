import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { demoClient } from "@/lib/demo/db";
import { DEMO } from "@/lib/demo/mode";

export async function createClient() {
  if (DEMO) return demoClient() as unknown as ReturnType<typeof realClient>;
  return realClient(await cookies());
}

function realClient(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // Server Components can't write cookies; the proxy refreshes the session instead.
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {}
        },
      },
    },
  );
}
