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
      async (_event: string, session: { user: SupabaseUser } | null) => {
        const sbUser = session?.user ?? null;
        setAuthUser(sbUser);
        await loadProfile(sbUser);
        setIsLoading(false);
      }
    );

    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  // Tab-recovery: after a long suspension, Supabase's auto-refresh timer can
  // wedge in a never-resolving state and every query hangs forever. When the
  // tab becomes visible again, force a session refresh + cache invalidation.
  // If the refresh itself stalls past 5s, reload — same outcome as the user's
  // manual reload but automatic.
  useEffect(() => {
    const HIDDEN_THRESHOLD_MS = 2 * 60 * 1000;
    const REFRESH_TIMEOUT_MS = 5 * 1000;
    let hiddenAt: number | null = null;

    const handle = async () => {
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
      }
    };

    document.addEventListener("visibilitychange", handle);
    return () => document.removeEventListener("visibilitychange", handle);
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
