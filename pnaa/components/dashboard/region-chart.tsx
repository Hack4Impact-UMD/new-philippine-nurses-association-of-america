"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import type { RegionStat } from "@/hooks/use-dashboard-stats";

const config = {
  active: { label: "Active", color: "var(--chart-1)" },
  lapsed: { label: "Lapsed", color: "#3b82f6" },
} satisfies ChartConfig;

const activeShape = makeStackShape({
  orientation: "horizontal",
  position: "first",
  myKey: "active",
  otherKey: "lapsed",
});
const lapsedShape = makeStackShape({
  orientation: "horizontal",
  position: "last",
  myKey: "lapsed",
  otherKey: "active",
});

export function RegionChart({
  regions,
  loading,
}: {
  regions: RegionStat[];
  loading: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Members by Region</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[260px] w-full rounded-md" />
        ) : regions.length === 0 ? (
          <div className="flex h-[260px] items-center justify-center">
            <p className="text-sm text-muted-foreground">
              No regional data available.
            </p>
          </div>
        ) : (
          <ChartContainer
            config={config}
            className="aspect-auto w-full"
            style={{ height: Math.max(220, regions.length * 44) }}
          >
            <BarChart
              accessibilityLayer
              data={regions}
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
                shape={activeShape}
              />
              <Bar
                dataKey="lapsed"
                stackId="x"
                fill="var(--color-lapsed)"
                shape={lapsedShape}
              />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
