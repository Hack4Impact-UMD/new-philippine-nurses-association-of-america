"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, CalendarClock, Calendar, DollarSign } from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";
import type { DashboardStats } from "@/hooks/use-dashboard-stats";
import type { LucideIcon } from "lucide-react";

type Tone = "blue" | "amber" | "violet" | "emerald";

// Static class strings so Tailwind can see them at build time.
const TONE: Record<Tone, string> = {
  blue: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
};

function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  tone,
  href,
  footer,
}: {
  title: string;
  value: string;
  subtitle?: React.ReactNode;
  icon: LucideIcon;
  tone: Tone;
  href?: string;
  footer?: React.ReactNode;
}) {
  const body = (
    <Card
      className={cn(
        "h-full transition-shadow",
        href && "hover:shadow-md hover:border-foreground/15"
      )}
    >
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
          </div>
          <div className={cn("rounded-lg p-2 shrink-0", TONE[tone])}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
        {footer}
        {subtitle && (
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        )}
      </CardContent>
    </Card>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

function StatCardSkeleton() {
  return (
    <Card className="h-full">
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-7 w-16" />
          </div>
          <Skeleton className="h-9 w-9 rounded-lg" />
        </div>
        <Skeleton className="h-3 w-32" />
      </CardContent>
    </Card>
  );
}

/** Two-segment active/lapsed bar. */
function RatioBar({ active, lapsed }: { active: number; lapsed: number }) {
  const total = active + lapsed;
  const activePct = total > 0 ? (active / total) * 100 : 0;
  return (
    <div
      className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted"
      role="img"
      aria-label={`${active} active, ${lapsed} lapsed`}
    >
      <div className="bg-emerald-500" style={{ width: `${activePct}%` }} />
      <div className="bg-amber-500" style={{ width: `${100 - activePct}%` }} />
    </div>
  );
}

export function StatsCards({
  stats,
  loading,
}: {
  stats: DashboardStats | null;
  loading: boolean;
}) {
  if (loading || !stats) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  const lapsedPct =
    stats.totalMembers > 0
      ? (stats.lapsedMembers / stats.totalMembers) * 100
      : 0;

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <StatCard
        title="Total Members"
        value={stats.totalMembers.toLocaleString()}
        icon={Users}
        tone="blue"
        footer={
          <RatioBar active={stats.activeMembers} lapsed={stats.lapsedMembers} />
        }
        subtitle={
          <>
            <span className="font-medium text-emerald-600 dark:text-emerald-400">
              {stats.activeMembers.toLocaleString()}
            </span>{" "}
            active ·{" "}
            <span
              className={cn(
                "font-medium",
                lapsedPct > 25 && "text-amber-600 dark:text-amber-400"
              )}
            >
              {stats.lapsedMembers.toLocaleString()}
            </span>{" "}
            lapsed
          </>
        }
      />

      <StatCard
        title="Renewals Due"
        value={stats.renewalsDue30.toLocaleString()}
        icon={CalendarClock}
        tone="amber"
        href="/members"
        subtitle={
          stats.renewalsDue30 > 0
            ? "Active members renewing in 30 days"
            : "No renewals in the next 30 days"
        }
      />

      <StatCard
        title="Upcoming Events"
        value={stats.upcomingEvents.toLocaleString()}
        icon={Calendar}
        tone="violet"
        href="/events"
        subtitle="Scheduled and not archived"
      />

      <StatCard
        title="Total Fundraised"
        value={formatCurrency(stats.totalFundraised)}
        icon={DollarSign}
        tone="emerald"
        href="/fundraising"
        subtitle="Across all active campaigns"
      />
    </div>
  );
}
