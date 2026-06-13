"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Chapter } from "@/types/chapter";

type SortMode = "largest" | "at-risk";

/** Lapsed share of total membership, 0 when a chapter has no members. */
function lapsedPct(c: Chapter): number {
  return c.totalMembers > 0 ? (c.totalLapsed / c.totalMembers) * 100 : 0;
}

export function ChapterListWidget({
  chapters,
}: {
  chapters: (Chapter & { id: string })[];
}) {
  const [mode, setMode] = useState<SortMode>("largest");

  const top = useMemo(() => {
    const sorted = [...chapters];
    if (mode === "largest") {
      sorted.sort((a, b) => b.totalMembers - a.totalMembers);
    } else {
      // Surface chapters bleeding members. Ignore tiny chapters where a single
      // lapse swings the percentage by requiring a small membership floor.
      sorted.sort((a, b) => {
        const aRisk = a.totalMembers >= 5 ? lapsedPct(a) : -1;
        const bRisk = b.totalMembers >= 5 ? lapsedPct(b) : -1;
        return bRisk - aRisk;
      });
    }
    return sorted.slice(0, 10);
  }, [chapters, mode]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">Chapter Overview</CardTitle>
          <span className="text-xs text-muted-foreground tabular-nums">
            {chapters.length}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded-md border p-0.5 text-xs">
            {(["largest", "at-risk"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  "rounded px-2 py-1 font-medium transition-colors",
                  mode === m
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {m === "largest" ? "Largest" : "At-risk"}
              </button>
            ))}
          </div>
          <Link
            href="/chapters"
            className="text-sm text-primary flex items-center gap-1 hover:underline"
          >
            View all <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Chapter</TableHead>
              <TableHead>Region</TableHead>
              <TableHead className="text-right">Active</TableHead>
              <TableHead className="text-right">Lapsed</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {top.map((chapter) => {
              const pct = lapsedPct(chapter);
              return (
                <TableRow key={chapter.id}>
                  <TableCell>
                    <Link
                      href={`/chapters/${chapter.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {chapter.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {chapter.region}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {chapter.totalActive}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {chapter.totalLapsed}
                    <span
                      className={cn(
                        "ml-1 text-xs",
                        pct > 40
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-muted-foreground"
                      )}
                    >
                      ({pct.toFixed(0)}%)
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {chapter.totalMembers}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
