// Server-side Supabase clients for Next.js route handlers and server components.
//
// `supabaseAdmin()`  — service-role key, bypasses RLS. Use for privileged ops
//                       (e.g. admin user mgmt, sync triggers).
// `supabaseRoute()`  — cookie-bound, route-handler scoped. Reads user session
//                       from the `sb-*` cookies that @supabase/ssr writes.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

export function supabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars"
    );
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function supabaseRoute(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(toSet: { name: string; value: string; options: CookieOptions }[]) {
          for (const { name, value, options } of toSet) {
            cookieStore.set(name, value, options as CookieOptions);
          }
        },
      },
    }
  );
}

/** Returns the authenticated UID + role from the cookie session, or nulls. */
export async function getCaller(): Promise<{ uid: string | null; role: string | null }> {
  const supabase = await supabaseRoute();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { uid: null, role: null };
  const role = (data.user.app_metadata?.user_role as string | undefined) ?? null;
  return { uid: data.user.id, role };
}
