"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { makeStackShape } from "@/components/shared/chart-shapes";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useAuth, useIsAdmin } from "@/hooks/use-auth";
import { format, parseISO } from "date-fns";

interface RegionRow {
  region: string;
  active: number;
  lapsed: number;
}
interface LevelRow {
  level: string;
  active: number;
  lapsed: number;
}
interface EducationRow {
  education: string;
  total: number;
}
interface CliffRow {
  month: string;
  count: number;
}
interface MemberInsightsPayload {
  regions: RegionRow[];
  levels: LevelRow[];
  education: EducationRow[];
  cliff: CliffRow[];
}

const PIE_PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-3)",
  "#0E8E92",
  "#DB2777",
  "#4B5563",
] as const;

export function MemberInsights() {
  const { isLoading: authLoading } = useAuth();
  const isAdmin = useIsAdmin();
  const [payload, setPayload] = useState<MemberInsightsPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Don't issue the RPC for non-admins — the function raises and we'd just
    // log noise. Wait until auth resolves so we don't skip the call on first
    // render before the role lands.
    if (authLoading) return;
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const supabase = getSupabaseBrowser();
    (async () => {
      try {
        const { data, error } = await supabase.rpc("member_insights");
        if (cancelled) return;
        if (error) {
          console.error("member_insights RPC failed", error);
        } else {
          setPayload(data as MemberInsightsPayload);
        }
      } catch (err) {
        // Transport-level rejection (offline, aborted, tab throttling) — the
        // returned-`error` branch above doesn't cover a rejected promise.
        // Without this the four tabs would stay stuck on the skeleton forever.
        if (!cancelled) console.error("member_insights RPC rejected", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, isAdmin]);

  // Insights aggregate every chapter; visible to chapter admins and above.
  // Members see the list below as before.
  if (!authLoading && !isAdmin) return null;

  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="text-base">Member Insights</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="regions">
          <TabsList variant="line" className="flex-wrap h-auto justify-start">
            <TabsTrigger value="regions">Region Mix</TabsTrigger>
            <TabsTrigger value="levels">Membership Levels</TabsTrigger>
            <TabsTrigger value="cliff">Renewal Cliff</TabsTrigger>
            <TabsTrigger value="education">Education Mix</TabsTrigger>
          </TabsList>
          <TabsContent value="regions" className="mt-4">
            <RegionMix data={payload?.regions ?? []} loading={loading} />
          </TabsContent>
          <TabsContent value="levels" className="mt-4">
            <LevelMix data={payload?.levels ?? []} loading={loading} />
          </TabsContent>
          <TabsContent value="cliff" className="mt-4">
            <RenewalCliff data={payload?.cliff ?? []} loading={loading} />
          </TabsContent>
          <TabsContent value="education" className="mt-4">
            <EducationMix data={payload?.education ?? []} loading={loading} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

// ─── Region Mix ────────────────────────────────────────────────────────────
// Dual-tone matches the chapters-page activity chart blue (#3b82f6) instead
// of Philippine Gold for the secondary segment.
const statusConfig = {
  active: { label: "Active", color: "var(--chart-1)" },
  lapsed: { label: "Lapsed", color: "#3b82f6" },
} satisfies ChartConfig;

const horizontalActiveShape = makeStackShape({
  orientation: "horizontal",
  position: "first",
  myKey: "active",
  otherKey: "lapsed",
});
const horizontalLapsedShape = makeStackShape({
  orientation: "horizontal",
  position: "last",
  myKey: "lapsed",
  otherKey: "active",
});

function RegionMix({
  data,
  loading,
}: {
  data: RegionRow[];
  loading: boolean;
}) {
  if (loading) return <ChartSkeleton />;
  if (data.length === 0)
    return <EmptyChart message="No regional data available." />;

  return (
    <ChartContainer
      config={statusConfig}
      className="aspect-auto w-full"
      style={{ height: Math.max(220, data.length * 44) }}
    >
      <BarChart
        accessibilityLayer
        data={data}
        layout="vertical"
        margin={{ left: 0, right: 12 }}
      >
        <CartesianGrid horizontal={false} />
        <YAxis
          dataKey="region"
          type="category"
          tickLine={false}
          tickMargin={10}
          axisLine={false}
          width={150}
        />
        <XAxis type="number" hide />
        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar
          dataKey="active"
          stackId="x"
          fill="var(--color-active)"
          shape={horizontalActiveShape}
        />
        <Bar
          dataKey="lapsed"
          stackId="x"
          fill="var(--color-lapsed)"
          shape={horizontalLapsedShape}
        />
      </BarChart>
    </ChartContainer>
  );
}

// ─── Membership Levels ─────────────────────────────────────────────────────
function LevelMix({
  data,
  loading,
}: {
  data: LevelRow[];
  loading: boolean;
}) {
  // Top 10 levels — the long tail is usually one-off WA configurations.
  const trimmed = useMemo(() => data.slice(0, 10), [data]);

  if (loading) return <ChartSkeleton />;
  if (trimmed.length === 0)
    return <EmptyChart message="No membership-level data." />;

  return (
    <ChartContainer
      config={statusConfig}
      className="aspect-auto w-full"
      style={{ height: Math.max(220, trimmed.length * 44) }}
    >
      <BarChart
        accessibilityLayer
        data={trimmed}
        layout="vertical"
        margin={{ left: 0, right: 12 }}
      >
        <CartesianGrid horizontal={false} />
        <YAxis
          dataKey="level"
          type="category"
          tickLine={false}
          tickMargin={10}
          axisLine={false}
          width={170}
        />
        <XAxis type="number" hide />
        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar
          dataKey="active"
          stackId="x"
          fill="var(--color-active)"
          shape={horizontalActiveShape}
        />
        <Bar
          dataKey="lapsed"
          stackId="x"
          fill="var(--color-lapsed)"
          shape={horizontalLapsedShape}
        />
      </BarChart>
    </ChartContainer>
  );
}

// ─── Renewal Cliff ─────────────────────────────────────────────────────────
// Cumulative active-member count over the next 24 months assuming zero
// renewals. The slope of the area is the retention risk.

const cliffConfig = {
  count: { label: "Still active", color: "var(--chart-1)" },
} satisfies ChartConfig;

function RenewalCliff({
  data,
  loading,
}: {
  data: CliffRow[];
  loading: boolean;
}) {
  const chartData = useMemo(
    () =>
      data.map((d) => ({
        month: format(parseISO(d.month), "MMM yy"),
        count: d.count,
      })),
    [data]
  );

  if (loading) return <ChartSkeleton />;
  if (chartData.length === 0)
    return <EmptyChart message="No active members with renewal dates." />;

  const today = chartData[0]?.count ?? 0;
  const end = chartData[chartData.length - 1]?.count ?? 0;
  const drop = today > 0 ? Math.round(((today - end) / today) * 100) : 0;

  return (
    <div className="space-y-3">
      <ChartContainer
        config={cliffConfig}
        className="aspect-auto h-[260px] w-full"
      >
        <AreaChart
          accessibilityLayer
          data={chartData}
          margin={{ left: 0, right: 12 }}
        >
          <defs>
            <linearGradient id="cliff-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-count)" stopOpacity={0.4} />
              <stop offset="95%" stopColor="var(--color-count)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="month"
            tickLine={false}
            tickMargin={10}
            axisLine={false}
            minTickGap={24}
          />
          <YAxis
            tickLine={false}
            tickMargin={8}
            axisLine={false}
            width={40}
            allowDecimals={false}
          />
          <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
          <Area
            dataKey="count"
            type="monotone"
            stroke="var(--color-count)"
            strokeWidth={2}
            fill="url(#cliff-fill)"
          />
        </AreaChart>
      </ChartContainer>
      <p className="text-xs text-muted-foreground text-right tabular-nums">
        Today: {today.toLocaleString()} active → 24 months out (no renewals):{" "}
        {end.toLocaleString()} ({drop}% drop)
      </p>
    </div>
  );
}

// ─── Education Mix ─────────────────────────────────────────────────────────
function sanitizeKey(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "x"
  );
}

function EducationMix({
  data,
  loading,
}: {
  data: EducationRow[];
  loading: boolean;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const { rows, chartConfig } = useMemo(() => {
    const used = new Set<string>();
    const entries: { key: string; name: string; value: number; fill: string }[] = [];
    data.forEach(({ education, total }) => {
      const base = sanitizeKey(education);
      let k = base;
      let n = 1;
      while (used.has(k)) k = `${base}-${n++}`;
      used.add(k);
      entries.push({
        key: k,
        name: education,
        value: total,
        fill: `var(--color-${k})`,
      });
    });
    const cfg: ChartConfig = { value: { label: "Members" } };
    entries.forEach((e, i) => {
      cfg[e.key] = { label: e.name, color: PIE_PALETTE[i % PIE_PALETTE.length] };
    });
    return { rows: entries, chartConfig: cfg };
  }, [data]);

  const total = rows.reduce((s, d) => s + d.value, 0);

  if (loading) return <ChartSkeleton />;
  if (rows.length === 0 || total === 0)
    return <EmptyChart message="No education data reported." />;

  return (
    <div className="grid gap-4 sm:grid-cols-[1fr_240px] items-center">
      <ChartContainer
        config={chartConfig}
        className="mx-auto aspect-square w-full max-w-[280px]"
      >
        <PieChart>
          <ChartTooltip
            cursor={false}
            content={<ChartTooltipContent nameKey="key" hideLabel />}
          />
          <Pie
            data={rows}
            dataKey="value"
            nameKey="key"
            innerRadius={56}
            outerRadius={100}
            paddingAngle={1}
            strokeWidth={2}
            onMouseEnter={(_, idx) => setHoverIdx(idx)}
            onMouseLeave={() => setHoverIdx(null)}
          >
            {rows.map((_, i) => (
              <Cell
                key={i}
                opacity={hoverIdx === null || hoverIdx === i ? 1 : 0.3}
              />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
      <ul className="space-y-1.5 text-xs max-h-[240px] overflow-y-auto pr-1">
        {rows.map((d, i) => (
          <li
            key={d.key}
            className={`flex items-center gap-2 cursor-default transition-opacity ${
              hoverIdx === null || hoverIdx === i ? "opacity-100" : "opacity-40"
            }`}
            onMouseEnter={() => setHoverIdx(i)}
            onMouseLeave={() => setHoverIdx(null)}
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
              style={{ backgroundColor: PIE_PALETTE[i % PIE_PALETTE.length] }}
            />
            <span className="flex-1 truncate" title={d.name}>
              {d.name}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {d.value.toLocaleString()} (
              {((d.value / total) * 100).toFixed(0)}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Shared ────────────────────────────────────────────────────────────────
function ChartSkeleton() {
  return <Skeleton className="h-[260px] w-full rounded-md" />;
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="h-[260px] flex items-center justify-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
