"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { hydrateTimestamps } from "@/lib/supabase/timestamp";
import { invalidateChaptersMap } from "@/hooks/use-chapters-map";
import { invalidateSubevents } from "@/hooks/use-subevents";
import type { AppUser } from "@/types/user";

interface AuthContextType {
  authUser: SupabaseUser | null;
  user: (AppUser & { uid: string }) | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  signIn: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  authUser: null,
  user: null,
  isLoading: true,
  isAuthenticated: false,
  signIn: () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authUser, setAuthUser] = useState<SupabaseUser | null>(null);
  const [user, setUser] = useState<(AppUser & { uid: string }) | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const supabase = getSupabaseBrowser();

    const loadProfile = async (sbUser: SupabaseUser | null) => {
      if (!sbUser) {
        setUser(null);
        return;
      }
      const { data } = await supabase
        .from("users")
        .select("*")
        .eq("id", sbUser.id)
        .maybeSingle();
      if (data) {
        setUser({
          ...(hydrateTimestamps(data) as AppUser),
          uid: sbUser.id,
        });
      } else {
        setUser(null);
      }
    };

    supabase.auth.getSession().then(async ({ data }: { data: { session: { user: SupabaseUser } | null } }) => {
      const sbUser = data.session?.user ?? null;
      setAuthUser(sbUser);
      await loadProfile(sbUser);
      setIsLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(
      (_event: string, session: { user: SupabaseUser } | null) => {
        const sbUser = session?.user ?? null;
        setAuthUser(sbUser);
        // CRITICAL: do NOT await Supabase calls directly in this callback.
        // onAuthStateChange runs while supabase-js holds the auth lock, and
        // loadProfile issues a `from(...).select()` that needs the same lock —
        // awaiting it here deadlocks getSession() and every REST call forever
        // (Realtime still connects, so it looks like a silent data outage).
        // Defer the work to a fresh task so the lock is released first.
        setTimeout(() => {
          loadProfile(sbUser).finally(() => setIsLoading(false));
        }, 0);
      }
    );

    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  // Tab-recovery: the auth lock can wedge in a never-resolving state and every
  // query then hangs forever (see lib/supabase/client.ts). The timeout-bounded
  // lock prevents most wedges; this watchdog is the backstop that recovers any
  // that still slip through, via two triggers:
  //   1. Tab becomes visible after a long suspension (the classic case).
  //   2. A periodic health-check — covers a wedge on a continuously-visible tab
  //      (e.g. the 1h token expiry during active use), which trigger 1 misses.
  useEffect(() => {
    const HIDDEN_THRESHOLD_MS = 2 * 60 * 1000;
    const REFRESH_TIMEOUT_MS = 5 * 1000;
    const HEALTHCHECK_INTERVAL_MS = 60 * 1000;
    const HEALTHCHECK_TIMEOUT_MS = 4 * 1000;
    let hiddenAt: number | null = null;
    let recovering = false;

    // Force a session refresh + cache invalidation. If the refresh itself
    // stalls, reload — same outcome as the user's manual reload but automatic.
    const forceRefresh = async () => {
      if (recovering) return;
      recovering = true;
      const supabase = getSupabaseBrowser();
      try {
        await Promise.race([
          supabase.auth.refreshSession(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("refresh-timeout")), REFRESH_TIMEOUT_MS)
          ),
        ]);
        invalidateChaptersMap();
        invalidateSubevents();
      } catch {
        // Refresh stalled — the safest path is the user's manual fix.
        window.location.reload();
      } finally {
        recovering = false;
      }
    };

    const handleVisibility = async () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      if (document.visibilityState !== "visible") return;
      if (hiddenAt == null) return;
      const elapsed = Date.now() - hiddenAt;
      hiddenAt = null;
      if (elapsed < HIDDEN_THRESHOLD_MS) return;
      await forceRefresh();
    };

    // Probe getSession() with a short timeout. It resolves locally from the
    // stored session, so a timeout means the auth lock is wedged — recover.
    const healthCheck = async () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState !== "visible") return; // hidden tabs throttle timers anyway
      if (recovering) return;
      const supabase = getSupabaseBrowser();
      try {
        await Promise.race([
          supabase.auth.getSession(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("getSession-timeout")), HEALTHCHECK_TIMEOUT_MS)
          ),
        ]);
      } catch {
        await forceRefresh();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    const interval = setInterval(healthCheck, HEALTHCHECK_INTERVAL_MS);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      clearInterval(interval);
    };
  }, []);

  const signIn = () => {
    window.location.href = "/api/auth/signin";
  };

  const signOut = async () => {
    const supabase = getSupabaseBrowser();
    await supabase.auth.signOut();
    await fetch("/api/auth/signout", { method: "POST" });
    setUser(null);
    setAuthUser(null);
    window.location.href = "/signin";
  };

  return (
    <AuthContext.Provider
      value={{
        authUser,
        user,
        isLoading,
        isAuthenticated: !!user,
        signIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext() {
  return useContext(AuthContext);
}
