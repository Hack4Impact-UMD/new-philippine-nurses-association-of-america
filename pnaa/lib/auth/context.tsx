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
      console.log("[auth] loadProfile called; sbUser:", sbUser?.id ?? "null");
      if (!sbUser) {
        setUser(null);
        return;
      }
      try {
        console.log("[auth] firing users query for", sbUser.id);
        const queryStart = performance.now();
        const { data, error } = await supabase
          .from("users")
          .select("*")
          .eq("id", sbUser.id)
          .maybeSingle();
        console.log("[auth] users query returned in", Math.round(performance.now() - queryStart), "ms, error:", error, "data:", data);
        if (error) {
          console.error("[auth] loadProfile failed:", error);
          setUser(null);
          return;
        }
        if (data) {
          setUser({
            ...(hydrateTimestamps(data) as AppUser),
            uid: sbUser.id,
          });
        } else {
          console.warn("[auth] no public.users row for", sbUser.id);
          setUser(null);
        }
      } catch (err) {
        console.error("[auth] loadProfile threw:", err);
        setUser(null);
      }
    };

    // Always release the loading state, even if getSession/loadProfile rejects.
    // Without try/finally a hung network call would keep authLoading=true forever
    // and the consumer (e.g. /setup) would show a spinner indefinitely.
    supabase.auth
      .getSession()
      .then(async ({ data }: { data: { session: { user: SupabaseUser } | null } }) => {
        const sbUser = data.session?.user ?? null;
        console.log("[auth] getSession resolved; signed in:", !!sbUser);
        setAuthUser(sbUser);
        try {
          await loadProfile(sbUser);
        } finally {
          setIsLoading(false);
        }
      })
      .catch((err) => {
        console.error("[auth] getSession rejected:", err);
        setIsLoading(false);
      });

    const { data: sub } = supabase.auth.onAuthStateChange(
      async (event: string, session: { user: SupabaseUser } | null) => {
        const sbUser = session?.user ?? null;
        console.log("[auth] onAuthStateChange:", event, "signed in:", !!sbUser);
        setAuthUser(sbUser);
        try {
          await loadProfile(sbUser);
        } finally {
          setIsLoading(false);
        }
      }
    );

    return () => {
      sub.subscription.unsubscribe();
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
