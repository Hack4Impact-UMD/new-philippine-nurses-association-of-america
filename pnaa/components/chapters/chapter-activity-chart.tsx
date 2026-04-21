"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Chapter } from "@/types/chapter";

type ChapterRow = Chapter & { id: string };

interface Props {
  chapters: ChapterRow[];
  loading?: boolean;
}

export function ChapterActivityChart({ chapters, loading }: Props) {
  const regions = useMemo(() => {
    const set = new Set(chapters.map((c) => c.region).filter(Boolean));
    return ["All", ...Array.from(set).sort()];
  }, [chapters]);

  const [selectedRegion, setSelectedRegion] = useState("All");

  const bars = useMemo(() => {
    const filtered = selectedRegion === "All"
      ? chapters
      : chapters.filter((c) => c.region === selectedRegion);

    return [...filtered]
      .sort((a, b) => b.totalActive - a.totalActive)
      .slice(0, 20); // cap at 20 for readability
  }, [chapters, selectedRegion]);

  const max = Math.max(1, ...bars.map((c) => c.totalActive));

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Active Members by Chapter</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-40 w-full rounded-md bg-muted animate-pulse" />
        </CardContent>
      </Card>
    );
  }

  if (bars.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Active Members by Chapter</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground py-6 text-center">
            No chapter data available.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between flex-wrap gap-3">
        <CardTitle className="text-sm font-medium">Active Members by Chapter</CardTitle>

        {/* Region filter */}
        <div className="inline-flex items-center rounded-full border bg-muted p-1 gap-0.5 flex-wrap">
          {regions.map((r) => (
            <button
              key={r}
              onClick={() => setSelectedRegion(r)}
              className={`rounded-full px-3 py-0.5 text-xs font-medium transition-all ${
                selectedRegion === r
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </CardHeader>

      <CardContent>
        {/* Bars */}
        <div className="flex items-end gap-1 w-full overflow-x-auto">
          {bars.map((chapter) => (
            <div key={chapter.id} className="flex flex-col items-center gap-1 flex-1 min-w-[36px] group">
              {/* Value on hover */}
              <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity tabular-nums">
                {chapter.totalActive.toLocaleString()}
              </span>
              {/* Bar — height in px relative to a 160px max */}
              <div
                className="w-full bg-blue-500 rounded-t transition-all"
                style={{ height: `${(chapter.totalActive / max) * 160}px` }}
              />
              {/* Chapter name — truncated */}
              <span className="text-[10px] text-muted-foreground whitespace-nowrap overflow-hidden text-ellipsis max-w-full">
                {chapter.name.length > 10 ? chapter.name.slice(0, 9) + "…" : chapter.name}
              </span>
            </div>
          ))}
        </div>
        {bars.length === 20 && chapters.filter(c => selectedRegion === "All" || c.region === selectedRegion).length > 20 && (
          <p className="text-xs text-muted-foreground text-center mt-2">Showing top 20 chapters by active members</p>
        )}
      </CardContent>
    </Card>
  );
}
