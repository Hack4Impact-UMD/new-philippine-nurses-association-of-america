"use client";

import { useState } from "react";
import { format, parseISO, startOfMonth, subMonths } from "date-fns";
import { CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** A month as its first day, YYYY-MM-01. */
export type MonthKey = string;

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const pad = (n: number) => String(n).padStart(2, "0");
const key = (year: number, month: number): MonthKey => `${year}-${pad(month)}-01`;
const yearOf = (m: MonthKey) => Number(m.slice(0, 4));
const toKey = (d: Date): MonthKey => format(startOfMonth(d), "yyyy-MM-dd");
const clamp = (m: MonthKey, min: MonthKey, max: MonthKey) =>
  m < min ? min : m > max ? max : m;

/** "March 1998", "Jan – Dec 1998", or "Jan 1998 – Mar 2026". */
export function formatMonthRange(from: MonthKey, to: MonthKey): string {
  const f = parseISO(from);
  const t = parseISO(to);
  if (from === to) return format(f, "MMMM yyyy");
  if (yearOf(from) === yearOf(to)) return `${format(f, "MMM")} – ${format(t, "MMM yyyy")}`;
  return `${format(f, "MMM yyyy")} – ${format(t, "MMM yyyy")}`;
}

interface Preset {
  label: string;
  range: (max: MonthKey, min: MonthKey) => [MonthKey, MonthKey];
}

const PRESETS: Preset[] = [
  { label: "This month", range: (max) => [max, max] },
  { label: "Last 3 months", range: (max) => [toKey(subMonths(parseISO(max), 2)), max] },
  { label: "Last 12 months", range: (max) => [toKey(subMonths(parseISO(max), 11)), max] },
  { label: "This year", range: (max) => [key(yearOf(max), 1), max] },
  {
    label: "Last year",
    range: (max) => [key(yearOf(max) - 1, 1), key(yearOf(max) - 1, 12)],
  },
  { label: "All time", range: (max, min) => [min, max] },
];

/**
 * Picks an inclusive range of months between `min` and `max`. Built for spans
 * of decades: jump straight to a year, then click a start and an end month.
 * Presets cover the common ranges in one click.
 */
export function MonthRangePicker({
  from,
  to,
  min,
  max,
  onChange,
  className,
}: {
  from: MonthKey;
  to: MonthKey;
  min: MonthKey;
  max: MonthKey;
  onChange: (from: MonthKey, to: MonthKey) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"months" | "years">("months");
  const [year, setYear] = useState(() => yearOf(to));
  // First click of a range; the second click completes it.
  const [anchor, setAnchor] = useState<MonthKey | null>(null);
  const [hovered, setHovered] = useState<MonthKey | null>(null);

  const minYear = yearOf(min);
  const maxYear = yearOf(max);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setYear(yearOf(to));
      setView("months");
    }
    setAnchor(null);
    setHovered(null);
  }

  function commit(a: MonthKey, b: MonthKey) {
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    onChange(clamp(lo, min, max), clamp(hi, min, max));
    handleOpenChange(false);
  }

  function pickMonth(m: MonthKey) {
    if (anchor === null) {
      setAnchor(m);
    } else {
      commit(anchor, m);
    }
  }

  // While choosing the end month, preview the range under the pointer.
  const [lo, hi] = anchor
    ? [anchor, hovered ?? anchor].sort()
    : [from, to];

  const years: number[] = [];
  for (let y = maxYear; y >= minYear; y--) years.push(y);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          aria-label={`Months: ${formatMonthRange(from, to)}`}
          className={cn("h-9 justify-start gap-2 text-sm font-normal", className)}
        >
          <CalendarRange className="size-4 text-muted-foreground" />
          {formatMonthRange(from, to)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <div className="flex flex-col sm:flex-row">
          <div
            role="group"
            aria-label="Quick ranges"
            className="flex flex-wrap gap-1 border-b p-2 sm:w-36 sm:flex-col sm:flex-nowrap sm:border-r sm:border-b-0"
          >
            {PRESETS.map((p) => {
              const [pf, pt] = p.range(max, min);
              // A preset entirely before the first recorded month has nothing in it.
              const disabled = pt < min;
              return (
                <Button
                  key={p.label}
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  className="h-8 justify-start text-xs"
                  onClick={() => commit(pf, pt)}
                >
                  {p.label}
                </Button>
              );
            })}
          </div>

          <div className="w-64 p-3">
            <div className="mb-2 flex items-center justify-between">
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="Previous year"
                disabled={view === "years" || year <= minYear}
                onClick={() => setYear((y) => y - 1)}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-sm font-medium tabular-nums"
                aria-label={view === "months" ? `Choose year, showing ${year}` : "Back to months"}
                onClick={() => setView((v) => (v === "months" ? "years" : "months"))}
              >
                {view === "months" ? year : `${minYear} – ${maxYear}`}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="Next year"
                disabled={view === "years" || year >= maxYear}
                onClick={() => setYear((y) => y + 1)}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>

            {view === "years" ? (
              <div
                role="group"
                aria-label="Years"
                className="grid max-h-56 grid-cols-4 gap-1 overflow-y-auto"
              >
                {years.map((y) => (
                  <Button
                    key={y}
                    variant={y === year ? "default" : "ghost"}
                    size="sm"
                    className="h-8 text-xs tabular-nums"
                    aria-pressed={y === year}
                    onClick={() => {
                      setYear(y);
                      setView("months");
                    }}
                  >
                    {y}
                  </Button>
                ))}
              </div>
            ) : (
              <div
                role="group"
                aria-label={`Months of ${year}`}
                className="grid grid-cols-3 gap-1"
                onMouseLeave={() => setHovered(null)}
              >
                {MONTHS.map((mo) => {
                  const m = key(year, mo);
                  const outOfRange = m < min || m > max;
                  const isEdge = m === lo || m === hi;
                  const inRange = m >= lo && m <= hi;
                  return (
                    <Button
                      key={m}
                      variant={isEdge ? "default" : "ghost"}
                      size="sm"
                      disabled={outOfRange}
                      aria-label={format(parseISO(m), "MMMM yyyy")}
                      aria-pressed={inRange}
                      className={cn(
                        "h-9 text-xs",
                        inRange && !isEdge && "bg-accent text-accent-foreground"
                      )}
                      onMouseEnter={() => setHovered(m)}
                      onFocus={() => setHovered(m)}
                      onClick={() => pickMonth(m)}
                    >
                      {format(parseISO(m), "MMM")}
                    </Button>
                  );
                })}
              </div>
            )}

            <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">
              {anchor
                ? `From ${format(parseISO(anchor), "MMM yyyy")}: pick the end month.`
                : "Pick a start month, then an end month."}
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
