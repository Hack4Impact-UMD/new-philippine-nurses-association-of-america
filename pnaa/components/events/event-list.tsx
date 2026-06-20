"use client";
import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { SearchInput } from "@/components/shared/search-input";
import { EventCard } from "./event-card";
import { EmptyState } from "@/components/shared/empty-state";
import { ViewToggle, type ViewMode } from "@/components/shared/view-toggle";
import { AdvancedDataTable, type ColumnDef, type ColumnMeta } from "@/components/shared/advanced-data-table";
import { EventAttendanceChart } from "./event-attendance-chart";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { useDebounce } from "@/hooks/use-debounce";
import { useIsNationalAdmin } from "@/hooks/use-auth";
import { useChaptersMap } from "@/hooks/use-chapters-map";
import { formatDate } from "@/lib/utils";
import type { AppEvent } from "@/types/event";

type FilterMode = "upcoming" | "past" | "all";
type EventRow = AppEvent & { id: string };

const STORAGE_KEY = "pnaa-events-view";
const PAGE_SIZE = 25;

/** Escape LIKE wildcards in user input. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/**
 * Builds column defs. The chapter / region cells need the chapters lookup,
 * which only exists inside the component — hence the factory.
 */
function buildColumns(
  nameFor: (id: string | null | undefined) => string,
  regionFor: (id: string | null | undefined) => string,
): ColumnDef<EventRow, unknown>[] {
  return [
  {
    accessorKey: "name",
    header: "Event Name",
    size: 260,
    enableSorting: true,
    cell: ({ row }) => (
      <span className="font-medium text-sm line-clamp-2 leading-snug">
        {row.original.name}
      </span>
    ),
  },
  {
    accessorKey: "startDate",
    header: "Date",
    size: 120,
    enableSorting: true,
    cell: ({ row }) => (
      <span className="text-sm tabular-nums whitespace-nowrap">
        {formatDate(row.original.startDate)}
      </span>
    ),
  },
  {
    id: "time",
    header: "Time",
    size: 120,
    enableSorting: false,
    accessorFn: (row) => row.startTime ?? "",
    cell: ({ row }) =>
      row.original.startTime ? (
        <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
          {row.original.startTime}
          {row.original.endTime ? ` – ${row.original.endTime}` : ""}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground/50">—</span>
      ),
  },
  {
    accessorKey: "chapterId",
    header: "Chapter",
    size: 180,
    enableSorting: true,
    cell: ({ row }) => (
      <span className="text-sm">{nameFor(row.original.chapterId) || "—"}</span>
    ),
  },
  {
    id: "region",
    header: "Region",
    size: 140,
    enableSorting: true,
    accessorFn: (row) => regionFor(row.chapterId),
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">{regionFor(row.original.chapterId)}</span>
    ),
  },
  {
    accessorKey: "location",
    header: "Location",
    size: 180,
    enableSorting: true,
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground truncate block max-w-[170px]">
        {row.original.location || "—"}
      </span>
    ),
  },
  {
    accessorKey: "registrations",
    header: "Registered",
    size: 100,
    enableSorting: true,
    cell: ({ row }) => (
      <span className="tabular-nums text-sm text-muted-foreground">
        {(row.original.registrations ?? row.original.attendees) > 0
          ? (row.original.registrations ?? row.original.attendees).toLocaleString()
          : "—"}
      </span>
    ),
  },
  {
    accessorKey: "attendedCount",
    header: "Attended",
    size: 100,
    enableSorting: true,
    cell: ({ row }) => (
      <span className="tabular-nums text-sm">
        {(row.original.attendedCount ?? 0) > 0
          ? (row.original.attendedCount ?? 0).toLocaleString()
          : "—"}
      </span>
    ),
  },
  {
    accessorKey: "totalRevenue",
    header: "Total Revenue",
    size: 100,
    enableSorting: true,
    cell: ({ row }) => (
      <span className="tabular-nums text-sm">
        {row.original.totalRevenue > 0 ? `$${row.original.totalRevenue.toLocaleString("en-US")}` : "—"}
      </span>
    ),
  },
  {
    accessorKey: "volunteers",
    header: "Volunteers",
    size: 100,
    enableSorting: true,
    cell: ({ row }) => (
      <span className="tabular-nums text-sm">
        {row.original.volunteers > 0 ? row.original.volunteers.toLocaleString() : "—"}
      </span>
    ),
  },
  {
    accessorKey: "contactHours",
    header: "Contact Hrs",
    size: 110,
    enableSorting: true,
    cell: ({ row }) => (
      <span className="tabular-nums text-sm">
        {row.original.contactHours > 0 ? row.original.contactHours : "—"}
      </span>
    ),
  },
  {
    accessorKey: "source",
    header: "Source",
    size: 120,
    enableSorting: true,
    filterFn: "equalsString",
    meta: {
      filterType: "select",
      filterOptions: [
        { label: "Wild Apricot", value: "wildapricot" },
        { label: "Manual", value: "app" },
      ],
    } satisfies ColumnMeta,
    cell: ({ row }) => (
      <StatusBadge
        variant={row.original.source === "wildapricot" ? "wildapricot" : "app"}
      />
    ),
  },
  {
    accessorKey: "archived",
    header: "Status",
    size: 90,
    enableSorting: false,
    filterFn: "equals",
    meta: {
      filterType: "select",
      filterOptions: [
        { label: "Active", value: "false" },
        { label: "Archived", value: "true" },
      ],
    } satisfies ColumnMeta,
    accessorFn: (row) => String(row.archived),
    cell: ({ row }) =>
      row.original.archived ? (
        <Badge variant="secondary" className="text-xs text-muted-foreground">
          Archived
        </Badge>
      ) : (
        <Badge variant="outline" className="text-xs text-green-700 border-green-200 bg-green-50 dark:bg-green-950/30">
          Active
        </Badge>
      ),
  },
  ];
}

export function EventList() {
  const router = useRouter();
  const isNationalAdmin = useIsNationalAdmin();
  const { nameFor, regionFor } = useChaptersMap();
  const [search, setSearch] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("upcoming");
  const [showArchived, setShowArchived] = useState(false);
  const debouncedSearch = useDebounce(search, 300);
  const baseColumns = useMemo(() => buildColumns(nameFor, regionFor), [nameFor, regionFor]);
  const columns = useMemo(
    () =>
      isNationalAdmin
        ? baseColumns
        : baseColumns.filter(
            (c) => !("accessorKey" in c && c.accessorKey === "totalRevenue")
          ),
    [isNationalAdmin, baseColumns]
  );
  const [view, setView] = useState<ViewMode>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem(STORAGE_KEY) as ViewMode) ?? "table";
    }
    return "table";
  });

  // Paginated query state
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<EventRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // Chart data: always the last 12 months of active events, independent of
  // the current filter/page so the attendance trend is never clipped.
  const [chartEvents, setChartEvents] = useState<(AppEvent & { id: string })[]>([]);

  const today = useMemo(() => new Date().toISOString().split("T")[0], []);
  const chartCutoff = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 12);
    return d.toISOString().split("T")[0];
  }, []);

  // Reset to page 0 on any filter/search change.
  const handleSearch = (v: string) => { setSearch(v); setPage(0); };
  const handleFilterMode = (v: FilterMode) => { setFilterMode(v); setPage(0); };
  const handleShowArchived = () => { setShowArchived((prev) => !prev); setPage(0); };

  // Main paginated query
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const supabase = getSupabaseBrowser();
    const trimmed = debouncedSearch.trim();

    let q = supabase.from("events").select("*", { count: "exact" });

    if (!showArchived) q = q.eq("archived", false);

    if (filterMode === "upcoming") {
      q = q.gte("startDate", today).order("startDate", { ascending: true });
    } else if (filterMode === "past") {
      q = q.lt("startDate", today).order("startDate", { ascending: false });
    } else {
      q = q.order("startDate", { ascending: false });
    }

    if (trimmed) {
      // Search by event name or location (ILIKE, backed by the small table size).
      // Chapter-name search isn't supported server-side; use the date/archived
      // filters to narrow by chapter context instead.
      const esc = escapeLike(trimmed);
      q = q.or(`name.ilike.%${esc}%,location.ilike.%${esc}%`);
    }

    q.order("id", { ascending: true }) // stable tiebreaker for same-date events
     .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
     .then(({ data, count, error }) => {
       if (cancelled) return;
       if (error) {
         console.error("Failed to load events", error);
         setRows([]);
         setTotal(null);
       } else {
         setRows((data ?? []).map((d) => ({ ...(d as unknown as AppEvent), id: String((d as Record<string, unknown>).id) })));
         setTotal(count ?? null);
       }
       setLoading(false);
     });

    return () => { cancelled = true; };
  }, [page, debouncedSearch, filterMode, showArchived, today]);

  // Chart data: one-time fetch, last 12 months, unaffected by pagination.
  useEffect(() => {
    const supabase = getSupabaseBrowser();
    supabase
      .from("events")
      .select("id,name,startDate,chapterId,attendees")
      .eq("archived", false)
      .gte("startDate", chartCutoff)
      .lte("startDate", today)
      .then(({ data }) => {
        if (data) {
          setChartEvents(data.map((d) => ({ ...(d as unknown as AppEvent), id: String((d as Record<string, unknown>).id) })));
        }
      });
  }, [chartCutoff, today]);

  const handleViewChange = (v: ViewMode) => {
    setView(v);
    localStorage.setItem(STORAGE_KEY, v);
  };

  const pageCount = total !== null ? Math.max(1, Math.ceil(total / PAGE_SIZE)) : null;
  const hasMore = total !== null ? (page + 1) * PAGE_SIZE < total : rows.length === PAGE_SIZE;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput
          value={search}
          onChange={handleSearch}
          placeholder="Search events by name or location..."
          className="w-full sm:max-w-sm"
        />
        <div className="flex items-center gap-2 flex-wrap">
          {/* Date range pill filter */}
          <div className="inline-flex items-center rounded-full border bg-muted p-1 gap-0.5">
            {(["upcoming", "past", "all"] as FilterMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => handleFilterMode(mode)}
                className={`rounded-full px-3 py-1 text-sm font-medium transition-all ${
                  filterMode === mode
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleShowArchived}
            className={showArchived ? "text-primary" : "text-muted-foreground"}
          >
            {showArchived ? "Hide Archived" : "Show Archived"}
          </Button>
          <ViewToggle view={view} onViewChange={handleViewChange} />
        </div>
      </div>

      <EventAttendanceChart events={chartEvents} loading={loading && chartEvents.length === 0} />

      {view === "table" ? (
        <AdvancedDataTable<EventRow>
          columns={columns}
          data={rows}
          loading={loading}
          onRowClick={(event) => router.push(`/events/${event.id}`)}
          emptyTitle="No events found"
          emptyDescription="No events match the current filter"
          emptyIcon={Calendar}
          defaultPageSize={PAGE_SIZE}
          exportFilename="PNAA_events"
        />
      ) : loading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-48 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Calendar}
          title="No events found"
          description={
            search ? "Try adjusting your search" : "No events match the current filter"
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {rows.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}

      {/* Pagination controls */}
      <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
        {total !== null && (
          <span className="tabular-nums">
            {total.toLocaleString()} event{total !== 1 ? "s" : ""}
          </span>
        )}
        <span className="tabular-nums">
          Page {page + 1}
          {pageCount !== null ? ` of ${pageCount.toLocaleString()}` : ""}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2"
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={page === 0 || loading}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2"
          onClick={() => setPage((p) => p + 1)}
          disabled={!hasMore || loading}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
