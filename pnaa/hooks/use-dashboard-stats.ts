"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type DashboardScope = "national" | "region" | "chapter";

export interface RegionStat {
  region: string;
  active: number;
  lapsed: number;
}

export interface DashboardStats {
  scope: DashboardScope;
  totalMembers: number;
  activeMembers: number;
  lapsedMembers: number;
  /** Active members whose renewal falls within the next 30 days. */
  renewalsDue30: number;
  totalChapters: number;
  upcomingEvents: number;
  totalFundraised: number;
  /** Members-by-region — empty for chapter scope. */
  regions: RegionStat[];
}

/**
 * Single-round-trip dashboard aggregates via the `dashboard_stats` RPC, scoped
 * to the caller's role server-side. Returns `refetch` so the sync button can
 * refresh the cards after kicking off a run.
 */
export function useDashboardStats() {
  const { isLoading: authLoading, isAuthenticated } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchStats = useCallback(async () => {
    const supabase = getSupabaseBrowser();
    const { data, error: err } = await supabase.rpc("dashboard_stats");
    if (err) {
      console.error("dashboard_stats RPC failed", err);
      setError(err);
      setLoading(false);
      return;
    }
    setStats(data as DashboardStats);
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (authLoading || !isAuthenticated) return;
    (async () => {
      try {
        await fetchStats();
      } catch (err) {
        // Transport-level rejection (offline, throttled tab) — the returned
        // `error` branch in fetchStats doesn't cover a rejected promise.
        console.error("dashboard_stats RPC rejected", err);
        setLoading(false);
      }
    })();
  }, [authLoading, isAuthenticated, fetchStats]);

  // Derive the public loading flag so the effect never sets state synchronously:
  // still resolving auth, or authed and the first fetch hasn't landed.
  const effectiveLoading = authLoading || (isAuthenticated && loading);

  return { stats, loading: effectiveLoading, error, refetch: fetchStats };
}
