"use client";

import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { FundraisingCampaign } from "@/types/fundraising";

interface Props {
  campaigns: (FundraisingCampaign & { id: string })[];
  loading?: boolean;
}

function formatMonth(ym: string) {
  const parts = ym.split("-");
  if (parts.length < 2) return "";
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return "";
  return new Date(y, m - 1).toLocaleString("default", {
    month: "short",
    year: "2-digit",
  });
}

const MONTH_KEY_RE = /^\d{4}-\d{2}$/;

function formatCurrency(v: number) {
  return "$" + v.toLocaleString();
}

export function FundraisingChart({ campaigns, loading }: Props) {
  const chartData = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of campaigns) {
      if (!c.date || c.date.length < 7) continue;
      const month = c.date.slice(0, 7);
      if (!MONTH_KEY_RE.test(month)) continue;
      map.set(month, (map.get(month) ?? 0) + (c.amount ?? 0));
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, total]) => ({ month: formatMonth(month), total }));
  }, [campaigns]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Amount Raised Over Time</CardTitle>
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
          <CardTitle className="text-sm font-medium">Amount Raised Over Time</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground py-6 text-center">
            No fundraising data to display yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Amount Raised Over Time</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={52} tickFormatter={(v) => "$" + (v >= 1000 ? (v / 1000).toFixed(0) + "k" : v)} />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
              formatter={(value) => {
                const formatted =
                  typeof value === "number" && Number.isFinite(value)
                    ? formatCurrency(value)
                    : String(value ?? formatCurrency(0));
                return [formatted, "Raised"];
              }}
            />
            <Bar dataKey="total" fill="#3b82f6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
