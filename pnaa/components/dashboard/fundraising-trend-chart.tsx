"use client";

import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatCurrency } from "@/lib/utils";
import type { FundraisingCampaign } from "@/types/fundraising";

interface Props {
  campaigns: (FundraisingCampaign & { id: string })[];
}

const chartConfig = {
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

const TICK_CURRENCY = (v: number) =>
  v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`;

export function FundraisingTrendChart({ campaigns }: Props) {
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
      .slice(-6)
      .map(([month, total]) => ({ month: formatMonth(month), total }));
  }, [campaigns]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Fundraising Trend</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground py-10 text-center">
            No fundraising data available.
          </p>
        ) : (
          <ChartContainer config={chartConfig} className="aspect-auto h-[220px] w-full">
            <BarChart accessibilityLayer data={data} margin={{ left: 0, right: 12 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="month"
                tickLine={false}
                tickMargin={10}
                axisLine={false}
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
              <Bar dataKey="total" fill="var(--color-total)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
