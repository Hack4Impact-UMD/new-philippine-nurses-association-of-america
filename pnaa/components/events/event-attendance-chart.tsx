"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AppEvent } from "@/types/event";

interface Props {
  events: (AppEvent & { id: string })[];
  loading?: boolean;
}

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#06b6d4"];

// Chart drawing area
const W = 600;
const H = 200;
const PAD_LEFT = 40;
const PAD_RIGHT = 16;
const PAD_TOP = 16;
const PAD_BOTTOM = 32;
const DRAW_W = W - PAD_LEFT - PAD_RIGHT;
const DRAW_H = H - PAD_TOP - PAD_BOTTOM;

function formatMonth(ym: string) {
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1).toLocaleString("default", {
    month: "short",
    year: "2-digit",
  });
}

export function EventAttendanceChart({ events, loading }: Props) {
  // Only look at the last 12 months
  const twelveMonthsAgo = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 12);
    return d.toISOString().slice(0, 7);
  }, []);

  const { months, regions, series, max } = useMemo(() => {
    // Sum attendees per month per region
    const grid = new Map<string, Map<string, number>>(); // month → region → total
    const regionSet = new Set<string>();

    for (const e of events) {
      if (!e.startDate || !e.region) continue;
      const month = e.startDate.slice(0, 7);
      if (month < twelveMonthsAgo) continue;
      if (!grid.has(month)) grid.set(month, new Map());
      const row = grid.get(month)!;
      row.set(e.region, (row.get(e.region) ?? 0) + (e.attendees ?? 0));
      regionSet.add(e.region);
    }

    const months = Array.from(grid.keys()).sort();
    const regions = Array.from(regionSet).sort();
    const series = regions.map((r) => months.map((m) => grid.get(m)?.get(r) ?? 0));
    const max = Math.max(1, ...series.flat());

    return { months, regions, series, max };
  }, [events, twelveMonthsAgo]);

  // x position for month index i
  const x = (i: number) =>
    months.length < 2 ? DRAW_W / 2 : (i / (months.length - 1)) * DRAW_W;

  // y position for a value
  const y = (v: number) => DRAW_H - (v / max) * DRAW_H;

  // Y-axis ticks
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((p) => Math.round(p * max));

  // X-axis: show at most 6 labels
  const step = Math.max(1, Math.ceil(months.length / 6));

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Attendance Over Time by Region</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-40 w-full rounded-md bg-muted animate-pulse" />
        </CardContent>
      </Card>
    );
  }

  if (months.length === 0) {
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
        {/* Legend */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3">
          {regions.map((r, i) => (
            <span key={r} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="inline-block w-4 h-0.5 rounded" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
              {r}
            </span>
          ))}
        </div>

        {/* SVG line chart */}
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 280 }}>
          <g transform={`translate(${PAD_LEFT}, ${PAD_TOP})`}>

            {/* Horizontal grid lines + Y labels */}
            {yTicks.map((tick) => (
              <g key={tick}>
                <line x1={0} x2={DRAW_W} y1={y(tick)} y2={y(tick)} stroke="currentColor" strokeOpacity={0.08} strokeWidth={1} />
                <text x={-6} y={y(tick)} textAnchor="end" dominantBaseline="middle" fontSize={9} fill="currentColor" opacity={0.5}>
                  {tick}
                </text>
              </g>
            ))}

            {/* X-axis labels */}
            {months.map((m, i) => {
              if (i % step !== 0 && i !== months.length - 1) return null;
              return (
                <text key={m} x={x(i)} y={DRAW_H + 14} textAnchor="middle" fontSize={9} fill="currentColor" opacity={0.5}>
                  {formatMonth(m)}
                </text>
              );
            })}

            {/* One line + dots per region */}
            {regions.map((region, ri) => {
              const color = COLORS[ri % COLORS.length];
              const points = series[ri].map((v, i) => `${x(i)},${y(v)}`).join(" ");
              return (
                <g key={region}>
                  <polyline points={points} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  {series[ri].map((v, i) => (
                    <circle key={i} cx={x(i)} cy={y(v)} r={3} fill={color}>
                      <title>{region} · {formatMonth(months[i])}: {v.toLocaleString()} attendees</title>
                    </circle>
                  ))}
                </g>
              );
            })}

          </g>
        </svg>
      </CardContent>
    </Card>
  );
}
