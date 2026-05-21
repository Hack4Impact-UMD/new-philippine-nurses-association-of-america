"use client";

import { useMemo, useState } from "react";
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
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { useAuth, useIsNationalAdmin } from "@/hooks/use-auth";
import { useChaptersMap } from "@/hooks/use-chapters-map";
import { formatCurrency } from "@/lib/utils";
import type { FundraisingCampaign } from "@/types/fundraising";

type CampaignRow = FundraisingCampaign & { id: string };

interface FundraisingInsightsProps {
  campaigns: CampaignRow[];
  loading?: boolean;
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

const TICK_CURRENCY = (v: number) =>
  v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`;

export function FundraisingInsights({
  campaigns,
  loading,
}: FundraisingInsightsProps) {
  const { isLoading: authLoading } = useAuth();
  const isNationalAdmin = useIsNationalAdmin();

  // National-admin only — these aggregate every chapter.
  if (!authLoading && !isNationalAdmin) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Fundraising Insights</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="monthly">
          <TabsList variant="line" className="flex-wrap h-auto justify-start">
            <TabsTrigger value="monthly">Monthly Total</TabsTrigger>
            <TabsTrigger value="cumulative">Cumulative Growth</TabsTrigger>
            <TabsTrigger value="chapters">Top Chapters</TabsTrigger>
            <TabsTrigger value="regions">Region Mix</TabsTrigger>
          </TabsList>
          <TabsContent value="monthly" className="mt-4">
            <MonthlyTotal campaigns={campaigns} loading={loading} />
          </TabsContent>
          <TabsContent value="cumulative" className="mt-4">
            <CumulativeGrowth campaigns={campaigns} loading={loading} />
          </TabsContent>
          <TabsContent value="chapters" className="mt-4">
            <TopChapters campaigns={campaigns} loading={loading} />
          </TabsContent>
          <TabsContent value="regions" className="mt-4">
            <RegionMix campaigns={campaigns} loading={loading} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

// ─── Monthly Total ─────────────────────────────────────────────────────────
const monthlyConfig = {
  total: { label: "Raised", color: "var(--chart-1)" },
} satisfies ChartConfig;

const MONTH_KEY_RE = /^\d{4}-\d{2}$/;

function formatMonth(ym: string) {
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1).toLocaleString("default", {
    month: "short",
    year: "2-digit",
  });
}

function MonthlyTotal({
  campaigns,
  loading,
}: {
  campaigns: CampaignRow[];
  loading?: boolean;
}) {
  const data = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of campaigns) {
      if (!c.date || c.date.length < 7) continue;
      const month = c.date.slice(0, 7);
      if (!MONTH_KEY_RE.test(month)) continue;
      map.set(month, (map.get(month) ?? 0) + (c.amount ?? 0));
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-24)
      .map(([month, total]) => ({ month: formatMonth(month), total }));
  }, [campaigns]);

  if (loading) return <ChartSkeleton />;
  if (data.length === 0)
    return <EmptyChart message="No fundraising data to display yet." />;

  return (
    <ChartContainer
      config={monthlyConfig}
      className="aspect-auto h-[260px] w-full"
    >
      <BarChart accessibilityLayer data={data} margin={{ left: 0, right: 12 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="month"
          tickLine={false}
          tickMargin={10}
          axisLine={false}
          minTickGap={16}
        />
        <YAxis
          tickLine={false}
          tickMargin={8}
          axisLine={false}
          width={52}
          tickFormatter={TICK_CURRENCY}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              formatter={(value) => formatCurrency(Number(value ?? 0))}
            />
          }
        />
        <Bar
          dataKey="total"
          fill="var(--color-total)"
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ChartContainer>
  );
}

// ─── Cumulative Growth ─────────────────────────────────────────────────────
const cumulativeConfig = {
  total: { label: "Cumulative", color: "var(--chart-1)" },
} satisfies ChartConfig;

function CumulativeGrowth({
  campaigns,
  loading,
}: {
  campaigns: CampaignRow[];
  loading?: boolean;
}) {
  const data = useMemo(() => {
    const monthly = new Map<string, number>();
    for (const c of campaigns) {
      if (!c.date || c.date.length < 7) continue;
      const month = c.date.slice(0, 7);
      if (!MONTH_KEY_RE.test(month)) continue;
      monthly.set(month, (monthly.get(month) ?? 0) + (c.amount ?? 0));
    }
    const sorted = [...monthly.entries()].sort(([a], [b]) =>
      a.localeCompare(b)
    );
    let running = 0;
    return sorted.map(([month, amount]) => {
      running += amount;
      return { month: formatMonth(month), total: running };
    });
  }, [campaigns]);

  if (loading) return <ChartSkeleton />;
  if (data.length === 0)
    return <EmptyChart message="No fundraising data to display yet." />;

  const lifetime = data[data.length - 1]?.total ?? 0;

  return (
    <div className="space-y-3">
      <ChartContainer
        config={cumulativeConfig}
        className="aspect-auto h-[260px] w-full"
      >
        <AreaChart
          accessibilityLayer
          data={data}
          margin={{ left: 0, right: 12 }}
        >
          <defs>
            <linearGradient id="cumulative-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-total)" stopOpacity={0.4} />
              <stop offset="95%" stopColor="var(--color-total)" stopOpacity={0} />
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
            width={52}
            tickFormatter={TICK_CURRENCY}
          />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                formatter={(value) => formatCurrency(Number(value ?? 0))}
              />
            }
          />
          <Area
            dataKey="total"
            type="monotone"
            stroke="var(--color-total)"
            strokeWidth={2}
            fill="url(#cumulative-fill)"
          />
        </AreaChart>
      </ChartContainer>
      <p className="text-xs text-muted-foreground text-right tabular-nums">
        Lifetime total: {formatCurrency(lifetime)}
      </p>
    </div>
  );
}

// ─── Top Chapters ──────────────────────────────────────────────────────────
const topChaptersConfig = {
  total: { label: "Raised", color: "var(--chart-1)" },
} satisfies ChartConfig;

function TopChapters({
  campaigns,
  loading,
}: {
  campaigns: CampaignRow[];
  loading?: boolean;
}) {
  const { nameFor } = useChaptersMap();

  const data = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of campaigns) {
      const id = c.chapterId ?? "unassigned";
      map.set(id, (map.get(id) ?? 0) + (c.amount ?? 0));
    }
    return [...map.entries()]
      .map(([id, total]) => ({
        id,
        name:
          id === "unassigned" ? "Unassigned" : nameFor(id) || "(unknown)",
        total,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [campaigns, nameFor]);

  if (loading) return <ChartSkeleton />;
  if (data.length === 0)
    return <EmptyChart message="No fundraising data to display yet." />;

  return (
    <ChartContainer
      config={topChaptersConfig}
      className="aspect-auto w-full"
      style={{ height: Math.max(220, data.length * 36) }}
    >
      <BarChart
        accessibilityLayer
        data={data}
        layout="vertical"
        margin={{ left: 0, right: 12 }}
      >
        <CartesianGrid horizontal={false} />
        <YAxis
          dataKey="name"
          type="category"
          tickLine={false}
          tickMargin={10}
          axisLine={false}
          width={170}
        />
        <XAxis type="number" tickFormatter={TICK_CURRENCY} hide />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              formatter={(value) => formatCurrency(Number(value ?? 0))}
            />
          }
        />
        <Bar dataKey="total" fill="var(--color-total)" radius={4} />
      </BarChart>
    </ChartContainer>
  );
}

// ─── Region Mix ────────────────────────────────────────────────────────────
function sanitizeKey(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "x"
  );
}

function RegionMix({
  campaigns,
  loading,
}: {
  campaigns: CampaignRow[];
  loading?: boolean;
}) {
  const { regionFor } = useChaptersMap();
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const { rows, chartConfig } = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of campaigns) {
      const region = regionFor(c.chapterId).trim() || "Unspecified";
      map.set(region, (map.get(region) ?? 0) + (c.amount ?? 0));
    }
    const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]);
    const used = new Set<string>();
    const entries: { key: string; name: string; value: number; fill: string }[] = [];
    sorted.forEach(([name, value]) => {
      const base = sanitizeKey(name);
      let k = base;
      let n = 1;
      while (used.has(k)) k = `${base}-${n++}`;
      used.add(k);
      entries.push({ key: k, name, value, fill: `var(--color-${k})` });
    });
    const cfg: ChartConfig = { value: { label: "Raised" } };
    entries.forEach((e, i) => {
      cfg[e.key] = { label: e.name, color: PIE_PALETTE[i % PIE_PALETTE.length] };
    });
    return { rows: entries, chartConfig: cfg };
  }, [campaigns, regionFor]);

  const total = rows.reduce((s, d) => s + d.value, 0);

  if (loading) return <ChartSkeleton />;
  if (rows.length === 0 || total === 0)
    return <EmptyChart message="No fundraising data to display yet." />;

  return (
    <div className="grid gap-4 sm:grid-cols-[1fr_240px] items-center">
      <ChartContainer
        config={chartConfig}
        className="mx-auto aspect-square w-full max-w-[280px]"
      >
        <PieChart>
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                nameKey="key"
                hideLabel
                formatter={(value) => formatCurrency(Number(value ?? 0))}
              />
            }
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
              {formatCurrency(d.value)} (
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
