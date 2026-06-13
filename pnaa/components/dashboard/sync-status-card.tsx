"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CheckCircle2,
  AlertTriangle,
  Clock,
  RefreshCw,
  Users,
  CalendarRange,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface SyncLogRow {
  id: string;
  type: string;
  status: string;
  triggeredAt?: { toDate: () => Date } | string | null;
  completedAt?: { toDate: () => Date } | string | null;
  error?: string | null;
}

function toDate(v: SyncLogRow["triggeredAt"]): Date | null {
  if (!v) return null;
  if (typeof v === "string") return new Date(v);
  if (typeof v === "object" && "toDate" in v) return v.toDate();
  return null;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "complete")
    return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (status === "failed")
    return <AlertTriangle className="h-4 w-4 text-red-500" />;
  return <Clock className="h-4 w-4 text-amber-500" />;
}

function SyncRow({
  label,
  icon: Icon,
  log,
}: {
  label: string;
  icon: typeof Users;
  log: SyncLogRow | undefined;
}) {
  const when = log ? toDate(log.completedAt) ?? toDate(log.triggeredAt) : null;
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <div className="flex items-center gap-2 min-w-0">
        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
        {log ? (
          <>
            <StatusIcon status={log.status} />
            <span className="truncate">
              {when ? formatDistanceToNow(when, { addSuffix: true }) : log.status}
            </span>
          </>
        ) : (
          <span>No runs recorded</span>
        )}
      </div>
    </div>
  );
}

export function SyncStatusCard() {
  const [logs, setLogs] = useState<SyncLogRow[] | null>(null);
  const [triggering, setTriggering] = useState(false);

  const load = useCallback(async () => {
    const supabase = getSupabaseBrowser();
    const { data, error } = await supabase
      .from("sync_logs")
      .select("*")
      .order("triggeredAt", { ascending: false })
      .limit(20);
    if (error) {
      console.error("sync_logs fetch failed", error);
      setLogs([]);
      return;
    }
    setLogs((data ?? []) as SyncLogRow[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Most recent log per type.
  const latest = (type: string) => logs?.find((l) => l.type === type);

  const triggerEvents = async () => {
    setTriggering(true);
    try {
      const res = await fetch("/api/sync/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "events" }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "Failed to start events sync");
      } else {
        toast.success(json.message ?? "Events sync started");
        // The API writes a 'triggered' log row synchronously; reflect it.
        await load();
      }
    } catch {
      toast.error("Failed to reach the sync endpoint");
    } finally {
      setTriggering(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Data Sync</CardTitle>
        <button
          type="button"
          onClick={load}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Refresh sync status"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </CardHeader>
      <CardContent className="space-y-3">
        {logs === null ? (
          <div className="space-y-2">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
        ) : (
          <div className="divide-y">
            <SyncRow label="Members" icon={Users} log={latest("members")} />
            <SyncRow label="Events" icon={CalendarRange} log={latest("events")} />
          </div>
        )}

        {latest("events")?.status === "failed" && (
          <p className="text-xs text-red-600 dark:text-red-400 line-clamp-2">
            {latest("events")?.error}
          </p>
        )}

        <Button
          size="sm"
          variant="outline"
          className="w-full"
          onClick={triggerEvents}
          disabled={triggering}
        >
          <RefreshCw className={cn("h-4 w-4", triggering && "animate-spin")} />
          {triggering ? "Starting…" : "Sync events now"}
        </Button>
        <p className="text-[11px] text-muted-foreground text-center">
          Members sync runs nightly via GitHub Actions.
        </p>
      </CardContent>
    </Card>
  );
}
