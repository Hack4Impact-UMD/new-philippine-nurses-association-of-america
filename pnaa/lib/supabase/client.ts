"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

// Timeout-bounded auth lock.
//
// auth-js serializes every token op (and therefore every getSession(), which
// each PostgREST query awaits to attach the Authorization header) through a
// `navigator.locks` exclusive lock. The default `navigatorLock` waits for the
// lock *forever*. If a tab is throttled/suspended (backgrounded, sleep, network
// blip) while it holds the lock, the lock can be left effectively unreleased —
// after which getSession() never resolves and ALL data fetching hangs silently.
//
// This replacement waits at most ACQUIRE_TIMEOUT_MS for the lock; if it can't
// be acquired in time (presumed wedged), it runs the operation WITHOUT the lock
// rather than hang. The session is cookie-backed and effectively single-session
// here, so the worst case is a rare duplicate token refresh across tabs, which
// the server tolerates. Healthy multi-tab coordination is preserved.
const ACQUIRE_TIMEOUT_MS = 10_000;

async function timeoutLock<R>(
  name: string,
  _acquireTimeout: number,
  fn: () => Promise<R>
): Promise<R> {
  if (typeof navigator === "undefined" || !navigator.locks?.request) {
    // No LockManager (SSR / old browser) — nothing to serialize against.
    return fn();
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ACQUIRE_TIMEOUT_MS);
  try {
    return await navigator.locks.request(
      `sb-auth-lock:${name}`,
      { mode: "exclusive", signal: ctrl.signal },
      async () => fn()
    );
  } catch (err) {
    if ((err as Error)?.name === "AbortError") {
      // Waited too long for a (presumed wedged) lock — proceed unlocked so the
      // caller can never hang forever.
      return fn();
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

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
        lock: timeoutLock,
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
