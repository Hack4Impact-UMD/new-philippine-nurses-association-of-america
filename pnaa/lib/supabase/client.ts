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

// ─────────────────────────────────────────────────────────────────────────────
// DO NOT REMOVE — load-bearing dead code.
//
// These three exports look unused (grep finds zero callers in the repo). They
// are not. Under Next 16 + Turbopack, deleting them causes
// `supabase.auth.getSession()` and every `supabase.from(...)` REST call from
// the browser client to hang forever, while the Realtime WebSocket still
// connects normally — so sign-in stalls but Realtime events fire. We bisected
// this twice (a27742e, and again after the May 20 cleanup).
//
// Keep the Proxy + aliases as harmless dead code unless and until we
// reproduce a build that genuinely doesn't need them.
// ─────────────────────────────────────────────────────────────────────────────
export const supabase = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    return (getSupabaseBrowser() as unknown as Record<string | symbol, unknown>)[prop];
  },
});
export const auth = supabase;
export const db = supabase;
