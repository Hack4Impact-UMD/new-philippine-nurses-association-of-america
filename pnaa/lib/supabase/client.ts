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
        // Disable navigator.locks-based serialization. Default uses a
        // process-wide lock that survives across tabs; if a previous tab
        // or hung dev server left the lock held, every getSession() and
        // .from() call blocks indefinitely (auth events still fire because
        // they don't need the lock). Run our auth ops directly instead.
        lock: async <T,>(_name: string, _timeout: number, fn: () => Promise<T>) => fn(),
      },
    }
  );
  // Debug: expose for direct console probing. Remove after auth is fixed.
  if (typeof window !== "undefined") {
    (window as unknown as { _sb: SupabaseClient })._sb = _client;
  }
  return _client;
}
