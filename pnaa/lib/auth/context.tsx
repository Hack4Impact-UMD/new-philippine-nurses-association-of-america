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
