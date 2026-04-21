"use client";

import { useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AppEvent } from "@/types/event";

interface Props {
  events: (AppEvent & { id: string })[];
  loading?: boolean;
}

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#06b6d4"];

function formatMonth(ym: string) {
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1).toLocaleString("default", {
    month: "short",
    year: "2-digit",
  });
}

export function EventAttendanceChart({ events, loading }: Props) {
  const currentMonth = useMemo(() => new Date().toISOString().slice(0, 7), []);
  const twelveMonthsAgo = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 12);
    return d.toISOString().slice(0, 7);
  }, []);

  const { chartData, regions } = useMemo(() => {
    const grid = new Map<string, Map<string, number>>();
    const regionSet = new Set<string>();

    for (const e of events) {
      if (!e.startDate || !e.region) continue;
      const month = e.startDate.slice(0, 7);
      if (month < twelveMonthsAgo || month > currentMonth) continue;
      if (!grid.has(month)) grid.set(month, new Map());
      const row = grid.get(month)!;
      row.set(e.region, (row.get(e.region) ?? 0) + (e.attendees ?? 0));
      regionSet.add(e.region);
    }

    const months = Array.from(grid.keys()).sort();
    const regions = Array.from(regionSet).sort();

    // Build recharts-friendly row per month: { month, RegionA: 12, RegionB: 5, ... }
    const chartData = months.map((m) => {
      const row: Record<string, string | number> = { month: formatMonth(m) };
      for (const r of regions) {
        row[r] = grid.get(m)?.get(r) ?? 0;
      }
      return row;
    });

    return { chartData, regions };
  }, [events, twelveMonthsAgo, currentMonth]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Attendance Over Time by Region</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-48 w-full rounded-md bg-muted animate-pulse" />
        </CardContent>
      </Card>
    );
  }

  if (chartData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Attendance Over Time by Region</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground py-6 text-center">
            No attendance data in the last 12 months. Make sure past events have attendee counts filled in.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Attendance Over Time by Region</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={36} />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
              formatter={(value) => [Number(value ?? 0).toLocaleString(), "Attendees"]}
            />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
            {regions.map((region, i) => (
              <Line
                key={region}
                type="monotone"
                dataKey={region}
                stroke={COLORS[i % COLORS.length]}
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
