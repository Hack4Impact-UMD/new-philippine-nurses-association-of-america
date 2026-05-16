"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

export function getSupabaseBrowser(): SupabaseClient {
  if (_client) return _client;
  _client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    }
  );
  return _client;
}

// Lazy singleton — matches the `auth` / `db` / `storage` export shape that the
// rest of the codebase imports.
export const supabase = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    return (getSupabaseBrowser() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

// Compatibility aliases — callers used to import { auth, db } from
// the old firebase config. They are the same Supabase client now, but
// we keep the names so call sites don't need to change.
export const auth = supabase;
export const db = supabase;
