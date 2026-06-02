"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import { makeStackShape } from "@/components/shared/chart-shapes";
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
import { addMonths, format, parseISO, startOfMonth } from "date-fns";
import type { Member } from "@/types/member";
import type { AppEvent } from "@/types/event";

type MemberRow = Member & { id: string };
type EventRow = AppEvent & { id: string };

interface ChapterInsightsProps {
  members: MemberRow[];
  events: EventRow[];
  loading?: boolean;
}

const verticalActiveShape = makeStackShape({
  orientation: "vertical",
  position: "first",
  myKey: "active",
  otherKey: "lapsed",
});
const verticalLapsedShape = makeStackShape({
  orientation: "vertical",
  position: "last",
  myKey: "lapsed",
  otherKey: "active",
});
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

// Pie palette: leans on the 5 PNAA chart tokens, with three tasteful extensions
// for chapters whose education mix has many distinct buckets.
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

export function ChapterInsights({
  members,
  events,
  loading,
}: ChapterInsightsProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Chapter Insights</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="renewals">
          <TabsList variant="line" className="flex-wrap h-auto justify-start">
            <TabsTrigger value="renewals">Renewal Pipeline</TabsTrigger>
            <TabsTrigger value="levels">Membership Levels</TabsTrigger>
            <TabsTrigger value="education">Education Mix</TabsTrigger>
            <TabsTrigger value="events">Event Impact</TabsTrigger>
          </TabsList>

          <TabsContent value="renewals" className="mt-4">
            <RenewalPipeline members={members} loading={loading} />
          </TabsContent>
          <TabsContent value="levels" className="mt-4">
            <MembershipLevels members={members} loading={loading} />
          </TabsContent>
          <TabsContent value="education" className="mt-4">
            <EducationMix members={members} loading={loading} />
          </TabsContent>
          <TabsContent value="events" className="mt-4">
            <EventImpact events={events} loading={loading} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

// ─── Renewal Pipeline ──────────────────────────────────────────────────────
// Dual-tone bar charts use the primary chart token (--chart-1, teal) + a
// brighter blue (#3b82f6, matching the chapters-page activity chart) instead
// of gold, per design preference. Tokens go through ChartContainer's --color-* aliasing.
const renewalConfig = {
  active: { label: "Active", color: "var(--chart-1)" },
  lapsed: { label: "Lapsed", color: "#3b82f6" },
} satisfies ChartConfig;

type RenewalRange = 6 | 12 | 24;

function RenewalPipeline({
  members,
  loading,
}: {
  members: MemberRow[];
  loading?: boolean;
}) {
  const [range, setRange] = useState<RenewalRange>(12);

  const data = useMemo(() => {
    const start = startOfMonth(new Date());
    const buckets = new Map<
      string,
      { month: string; active: number; lapsed: number }
    >();
    for (let i = 0; i < range; i++) {
      const d = addMonths(start, i);
      const key = format(d, "yyyy-MM");
      buckets.set(key, {
        month: format(d, range > 12 ? "MMM yy" : "MMM"),
        active: 0,
        lapsed: 0,
      });
    }
    for (const m of members) {
      if (!m.renewalDueDate) continue;
      let due: Date;
      try {
        due = parseISO(m.renewalDueDate);
      } catch {
        continue;
      }
      if (Number.isNaN(due.getTime())) continue;
      const key = format(startOfMonth(due), "yyyy-MM");
      const b = buckets.get(key);
      if (!b) continue;
      if (m.activeStatus === "Active") b.active++;
      else b.lapsed++;
    }
    return [...buckets.values()];
  }, [members, range]);

  if (loading) return <ChartSkeleton />;
  if (members.length === 0)
    return <EmptyChart message="No members loaded for this chapter." />;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <div className="inline-flex items-center rounded-full border bg-muted p-1 gap-0.5">
          {([6, 12, 24] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`rounded-full px-3 py-0.5 text-xs font-medium transition-all ${
                range === r
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {r}m
            </button>
          ))}
        </div>
      </div>
      <ChartContainer
        config={renewalConfig}
        className="aspect-auto h-[260px] w-full"
      >
        <BarChart accessibilityLayer data={data}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="month"
            tickLine={false}
            tickMargin={10}
            axisLine={false}
          />
          <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar
            dataKey="active"
            stackId="a"
            fill="var(--color-active)"
            shape={verticalActiveShape}
          />
          <Bar
            dataKey="lapsed"
            stackId="a"
            fill="var(--color-lapsed)"
            shape={verticalLapsedShape}
          />
        </BarChart>
      </ChartContainer>
    </div>
  );
}

// ─── Membership Levels ─────────────────────────────────────────────────────
const levelsConfig = {
  active: { label: "Active", color: "var(--chart-1)" },
  lapsed: { label: "Lapsed", color: "#3b82f6" },
} satisfies ChartConfig;

function MembershipLevels({
  members,
  loading,
}: {
  members: MemberRow[];
  loading?: boolean;
}) {
  const data = useMemo(() => {
    const map = new Map<
      string,
      { level: string; active: number; lapsed: number; total: number }
    >();
    for (const m of members) {
      const level = m.membershipLevel?.trim() || "Unspecified";
      if (!map.has(level))
        map.set(level, { level, active: 0, lapsed: 0, total: 0 });
      const b = map.get(level)!;
      if (m.activeStatus === "Active") b.active++;
      else b.lapsed++;
      b.total++;
    }
    return [...map.values()].sort((a, b) => b.total - a.total).slice(0, 8);
  }, [members]);

  if (loading) return <ChartSkeleton />;
  if (data.length === 0)
    return <EmptyChart message="No membership-level data." />;

  return (
    <ChartContainer
      config={levelsConfig}
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
          dataKey="level"
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

// ─── Education Mix ─────────────────────────────────────────────────────────
// Donut chart with a co-controlled legend. Slice names are dynamic, so the
// chartConfig is rebuilt per render with sanitized keys + per-slice colors.

function sanitizeKey(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "x"
  );
}

function EducationMix({
  members,
  loading,
}: {
  members: MemberRow[];
  loading?: boolean;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const { data, chartConfig } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of members) {
      const key = m.highestEducation?.trim() || "Unspecified";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const used = new Set<string>();
    const entries: { key: string; name: string; value: number; fill: string }[] = [];
    sorted.forEach(([name, value], i) => {
      const base = sanitizeKey(name);
      let k = base;
      let n = 1;
      while (used.has(k)) k = `${base}-${n++}`;
      used.add(k);
      entries.push({
        key: k,
        name,
        value,
        fill: `var(--color-${k})`,
      });
    });
    const cfg: ChartConfig = { value: { label: "Members" } };
    entries.forEach((e, i) => {
      cfg[e.key] = { label: e.name, color: PIE_PALETTE[i % PIE_PALETTE.length] };
    });
    return { data: entries, chartConfig: cfg };
  }, [members]);

  const total = data.reduce((s, d) => s + d.value, 0);

  if (loading) return <ChartSkeleton />;
  if (data.length === 0 || total === 0)
    return <EmptyChart message="No education data reported on these members." />;

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
            data={data}
            dataKey="value"
            nameKey="key"
            innerRadius={56}
            outerRadius={100}
            paddingAngle={1}
            strokeWidth={2}
            onMouseEnter={(_, idx) => setHoverIdx(idx)}
            onMouseLeave={() => setHoverIdx(null)}
          >
            {data.map((_, i) => (
              <Cell
                key={i}
                opacity={hoverIdx === null || hoverIdx === i ? 1 : 0.3}
              />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
      <ul className="space-y-1.5 text-xs max-h-[240px] overflow-y-auto pr-1">
        {data.map((d, i) => (
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
              {d.value} ({((d.value / total) * 100).toFixed(0)}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Event Impact ──────────────────────────────────────────────────────────
const eventsConfig = {
  attendees: { label: "Attendees", color: "var(--chart-1)" },
  contactHours: { label: "Contact Hours", color: "#3b82f6" },
  volunteerHours: { label: "Volunteer Hours", color: "var(--chart-5)" },
} satisfies ChartConfig;

function EventImpact({
  events,
  loading,
}: {
  events: EventRow[];
  loading?: boolean;
}) {
  const router = useRouter();

  const data = useMemo(() => {
    return events
      .filter((e) => !e.archived)
      .slice(0, 12)
      .reverse()
      .map((e) => ({
        id: e.id,
        name: e.name,
        attendees: e.attendees ?? 0,
        contactHours: e.contactHours ?? 0,
        volunteerHours: e.volunteerHours ?? 0,
      }));
  }, [events]);

  if (loading) return <ChartSkeleton />;
  if (data.length === 0)
    return <EmptyChart message="No events to compare yet." />;

  const openEvent = (payload: { id?: string } | undefined) => {
    if (payload?.id) router.push(`/events/${payload.id}`);
  };

  return (
    <ChartContainer
      config={eventsConfig}
      className="aspect-auto h-[300px] w-full"
    >
      <BarChart accessibilityLayer data={data} margin={{ left: 0, right: 12 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="name"
          tickLine={false}
          tickMargin={10}
          axisLine={false}
          tickFormatter={(v: string) => (v.length > 10 ? `${v.slice(0, 9)}…` : v)}
          interval={0}
        />
        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar
          dataKey="attendees"
          fill="var(--color-attendees)"
          radius={4}
          style={{ cursor: "pointer" }}
          onClick={(d) => openEvent(d as { id?: string })}
        />
        <Bar
          dataKey="contactHours"
          fill="var(--color-contactHours)"
          radius={4}
          style={{ cursor: "pointer" }}
          onClick={(d) => openEvent(d as { id?: string })}
        />
        <Bar
          dataKey="volunteerHours"
          fill="var(--color-volunteerHours)"
          radius={4}
          style={{ cursor: "pointer" }}
          onClick={(d) => openEvent(d as { id?: string })}
        />
      </BarChart>
    </ChartContainer>
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
