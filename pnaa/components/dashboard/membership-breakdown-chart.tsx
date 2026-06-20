"use client";

import { Cell, Pie, PieChart } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

interface Props {
  activeMembers: number;
  lapsedMembers: number;
}

const chartConfig = {
  active: { label: "Active", color: "var(--chart-1)" },
  lapsed: { label: "Lapsed", color: "var(--chart-3)" },
} satisfies ChartConfig;

export function MembershipBreakdownChart({ activeMembers, lapsedMembers }: Props) {
  const total = activeMembers + lapsedMembers;

  const data = [
    { key: "active", value: activeMembers, fill: "var(--color-active)" },
    { key: "lapsed", value: lapsedMembers, fill: "var(--color-lapsed)" },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Membership Breakdown</CardTitle>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <p className="text-sm text-muted-foreground py-10 text-center">
            No member data available.
          </p>
        ) : (
          <>
            <div className="relative">
              <ChartContainer
                config={chartConfig}
                className="mx-auto aspect-square max-h-[200px]"
              >
                <PieChart>
                  <ChartTooltip
                    cursor={false}
                    content={<ChartTooltipContent hideLabel nameKey="key" />}
                  />
                  <Pie
                    data={data}
                    dataKey="value"
                    nameKey="key"
                    innerRadius={58}
                    outerRadius={88}
                    strokeWidth={2}
                    paddingAngle={2}
                  >
                    {data.map((d) => (
                      <Cell key={d.key} fill={d.fill} />
                    ))}
                  </Pie>
                </PieChart>
              </ChartContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-2xl font-bold tabular-nums">
                  {Math.round((activeMembers / total) * 100)}%
                </span>
                <span className="text-xs text-muted-foreground">Active</span>
              </div>
            </div>
            <div className="flex justify-center gap-6 mt-2 text-sm">
              <div className="flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 rounded-[2px]"
                  style={{ backgroundColor: "var(--chart-1)" }}
                />
                <span className="text-muted-foreground">Active</span>
                <span className="font-medium tabular-nums">
                  {activeMembers.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 rounded-[2px]"
                  style={{ backgroundColor: "var(--chart-3)" }}
                />
                <span className="text-muted-foreground">Lapsed</span>
                <span className="font-medium tabular-nums">
                  {lapsedMembers.toLocaleString()}
                </span>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
