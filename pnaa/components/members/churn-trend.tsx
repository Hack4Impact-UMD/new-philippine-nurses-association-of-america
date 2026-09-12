"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";
import { format, parseISO } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useAuth, useIsAdmin } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import type { ChurnPoint } from "@/types/churn";
import { ScopeSelect, useViewScope } from "./scope-select";

// One series, so no legend: the card title names it. Teal is the repo's
// primary chart token and carries its own light/dark steps.
const chartConfig = {
  churnRate: { label: "Churn rate", color: "var(--chart-1)" },
} satisfies ChartConfig;

function formatPercent(rate: number | null, digits = 1): string {
  if (rate == null) return "—";
  return `${(rate * 100).toFixed(digits)}%`;
}

export function ChurnTrend() {
  const { isLoading: authLoading } = useAuth();
  const isAdmin = useIsAdmin();
  const scope = useViewScope();

  const [months, setMonths] = useState(12);
  const [showTable, setShowTable] = useState(false);
  const [points, setPoints] = useState<ChurnPoint[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refetching, setRefetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captureStart, setCaptureStart] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !isAdmin) return;
    let cancelled = false;
    const first = points === null;
    void (async () => {
      const supabase = getSupabaseBrowser();
      if (first) setLoading(true);
      else setRefetching(true);
      const { data, error: err } = await supabase.rpc("churn_trend", {
        p_scope_type: scope.scopeType,
        p_scope: scope.scope,
        p_months: months,
      });
      if (cancelled) return;
      if (err) {
        console.error("churn_trend RPC failed", err);
        setError(err.message ?? "Couldn't load churn data.");
        setPoints([]);
      } else {
        setError(null);
        setPoints((data ?? []) as ChurnPoint[]);
      }
      setLoading(false);
      setRefetching(false);
    })();
    return () => {
      cancelled = true;
    };
    // `points` is deliberately absent: it's read only to tell a first load from
    // a refetch, and including it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isAdmin, scope.scopeType, scope.scope, months]);

  // When measurement began — used by the empty state. RLS scopes this to what
  // the caller may see, and capture started at the same time for every scope.
  useEffect(() => {
    if (authLoading || !isAdmin) return;
    let cancelled = false;
    void (async () => {
      const supabase = getSupabaseBrowser();
      const { data } = await supabase
        .from("membership_base_counts")
        .select("periodStart")
        .order("periodStart", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      const row = data as { periodStart?: string } | null;
      if (row?.periodStart) setCaptureStart(row.periodStart);
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, isAdmin]);

  const measured = useMemo(
    () => (points ?? []).filter((p) => p.churnRate != null),
    [points]
  );

  // Trailing rate over the window: everyone lost, against the base we started
  // from. Null until there's a base to divide by.
  const trailing = useMemo(() => {
    if (measured.length === 0) return null;
    const lapsed = measured.reduce((sum, p) => sum + p.lapsed, 0);
    const startBase = measured[0].base;
    if (!startBase) return null;
    return { rate: lapsed / startBase, lapsed, from: measured[0].month, to: measured[measured.length - 1].month };
  }, [measured]);

  if (!authLoading && !isAdmin) return null;

  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="text-base">Membership Churn</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* One control row, above everything it scopes. */}
        <div className="flex flex-wrap items-center gap-2">
          <ScopeSelect scope={scope} />

          <div className="flex items-center gap-1">
            {[12, 24].map((m) => (
              <Button
                key={m}
                variant={months === m ? "default" : "outline"}
                size="sm"
                className="h-9 text-xs"
                onClick={() => setMonths(m)}
              >
                {m} mo
              </Button>
            ))}
          </div>

          <Button
            variant="outline"
            size="sm"
            className="h-9 text-xs ml-auto"
            onClick={() => setShowTable((v) => !v)}
            aria-pressed={showTable}
          >
            {showTable ? "Show chart" : "Show table"}
          </Button>
        </div>

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-12 w-40" />
            <Skeleton className="h-[260px] w-full" />
          </div>
        ) : error ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Couldn&apos;t load churn for this scope. {error}
          </p>
        ) : measured.length < 2 ? (
          <EmptyChurn captureStart={captureStart} />
        ) : (
          <div
            className={cn(
              "space-y-4 transition-opacity",
              refetching && "opacity-50"
            )}
          >
            <Hero trailing={trailing} scopeLabel={scope.label} />
            {showTable ? (
              <ChurnTable points={points ?? []} />
            ) : (
              <ChurnChart points={points ?? []} />
            )}
            <p className="text-xs text-muted-foreground">
              Churn is the share of the period&apos;s starting active members who
              lapsed. Months before measurement began are left out rather than
              shown as zero.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Hero figure ───────────────────────────────────────────────────────────
// Proportional figures, not tabular-nums: equal-width digits read loose at
// display sizes.

function Hero({
  trailing,
  scopeLabel,
}: {
  trailing: { rate: number; lapsed: number; from: string; to: string } | null;
  scopeLabel: string;
}) {
  if (!trailing) {
    return (
      <div>
        <p className="text-5xl font-semibold leading-none">—</p>
        <p className="mt-2 text-xs text-muted-foreground">
          No measured base yet for {scopeLabel}.
        </p>
      </div>
    );
  }
  return (
    <div>
      <p className="text-5xl font-semibold leading-none">
        {formatPercent(trailing.rate)}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        {scopeLabel} · {format(parseISO(trailing.from), "MMM yyyy")} –{" "}
        {format(parseISO(trailing.to), "MMM yyyy")} ·{" "}
        {trailing.lapsed.toLocaleString()} member
        {trailing.lapsed === 1 ? "" : "s"} lapsed
      </p>
    </div>
  );
}

// ─── Chart ─────────────────────────────────────────────────────────────────

function ChurnChart({ points }: { points: ChurnPoint[] }) {
  // The one point that gets a direct label: the last measured month.
  const lastMeasuredIndex = useMemo(() => {
    for (let i = points.length - 1; i >= 0; i--) {
      if (points[i].churnRate != null) return i;
    }
    return -1;
  }, [points]);

  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-[260px] w-full">
      <LineChart
        accessibilityLayer
        data={points}
        margin={{ left: 4, right: 28, top: 12, bottom: 4 }}
      >
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="month"
          tickLine={false}
          axisLine={false}
          tickMargin={10}
          // Thin the ticks by count rather than leaning on width measurement:
          // a 24-month window would otherwise pile 24 labels onto a card that
          // has to survive phone width.
          interval={points.length > 14 ? 2 : 1}
          minTickGap={24}
          // Bare month names repeat across a two-year window, so January
          // carries the year and anchors the rest.
          tickFormatter={(v: string) => {
            const d = parseISO(v);
            return d.getMonth() === 0 ? format(d, "MMM ''yy") : format(d, "MMM");
          }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={44}
          tickMargin={6}
          tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
        />
        <ChartTooltip cursor content={<ChurnTooltip />} />
        <Line
          type="monotone"
          dataKey="churnRate"
          stroke="var(--color-churnRate)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          // Gaps, not zeros: an unmeasured month has no line through it.
          connectNulls={false}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--background)" }}
          label={(props: unknown) => (
            <EndpointLabel
              {...(props as EndpointLabelProps)}
              lastIndex={lastMeasuredIndex}
            />
          )}
        />
      </LineChart>
    </ChartContainer>
  );
}

interface EndpointLabelProps {
  x?: number;
  y?: number;
  index?: number;
  value?: number | null;
  lastIndex?: number;
}

/**
 * Lines get their value at the end — one label, never a number on every point.
 * Recharts calls this once per datum, so every point but the last measured one
 * renders nothing.
 */
function EndpointLabel({ x, y, value, index, lastIndex }: EndpointLabelProps) {
  if (index == null || lastIndex == null || index !== lastIndex) return null;
  if (value == null || x == null || y == null) return null;
  return (
    <text
      x={x}
      y={y - 10}
      textAnchor="end"
      className="fill-muted-foreground text-[11px]"
    >
      {formatPercent(value)}
    </text>
  );
}

interface TooltipPayloadItem {
  payload: ChurnPoint;
}

function ChurnTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border bg-background px-2.5 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium">
        {format(parseISO(p.month), "MMMM yyyy")}
      </p>
      <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 tabular-nums">
        <dt className="text-muted-foreground">Churn</dt>
        <dd className="text-right font-medium">{formatPercent(p.churnRate)}</dd>
        <dt className="text-muted-foreground">Lapsed</dt>
        <dd className="text-right">{p.lapsed.toLocaleString()}</dd>
        <dt className="text-muted-foreground">Rejoined</dt>
        <dd className="text-right">{p.reactivated.toLocaleString()}</dd>
        <dt className="text-muted-foreground">Active at start</dt>
        <dd className="text-right">
          {p.base == null ? "not measured" : p.base.toLocaleString()}
        </dd>
      </dl>
    </div>
  );
}

// ─── Table view ────────────────────────────────────────────────────────────
// Every value the chart encodes is reachable without hovering.

function ChurnTable({ points }: { points: ChurnPoint[] }) {
  return (
    <div className="max-h-[260px] overflow-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Month</TableHead>
            <TableHead className="text-right">Churn</TableHead>
            <TableHead className="text-right">Lapsed</TableHead>
            <TableHead className="text-right">Rejoined</TableHead>
            <TableHead className="text-right">Active at start</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...points].reverse().map((p) => (
            <TableRow key={p.month}>
              <TableCell className="whitespace-nowrap">
                {format(parseISO(p.month), "MMM yyyy")}
              </TableCell>
              <TableCell className="text-right tabular-nums font-medium">
                {formatPercent(p.churnRate)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {p.lapsed.toLocaleString()}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {p.reactivated.toLocaleString()}
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {p.base == null ? "—" : p.base.toLocaleString()}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function EmptyChurn({ captureStart }: { captureStart: string | null }) {
  return (
    <div className="py-10 text-center">
      <p className="text-sm font-medium">Not enough history yet</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        {captureStart
          ? `Churn is measured from monthly snapshots that began ${format(
              parseISO(captureStart),
              "MMMM yyyy"
            )}. The first trend appears after two full months.`
          : "Churn is measured from monthly snapshots taken from this feature's launch onward. The first trend appears after two full months."}
      </p>
    </div>
  );
}
