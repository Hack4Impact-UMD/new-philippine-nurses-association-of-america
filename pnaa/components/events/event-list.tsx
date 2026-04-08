"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useCollection } from "@/hooks/use-firestore";
import { where, orderBy, limit } from "firebase/firestore";
import { SearchInput } from "@/components/shared/search-input";
import { EventCard } from "./event-card";
import { EmptyState } from "@/components/shared/empty-state";
import { ViewToggle, type ViewMode } from "@/components/shared/view-toggle";
import { AdvancedDataTable, type ColumnDef, type ColumnMeta } from "@/components/shared/advanced-data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "lucide-react";
import { toast } from "sonner";
import { useDebounce } from "@/hooks/use-debounce";
import { formatDate } from "@/lib/utils";
import type { AppEvent } from "@/types/event";

type FilterMode = "upcoming" | "past" | "all";
type EventRow = AppEvent & { id: string };

const STORAGE_KEY = "pnaa-events-view";

const columns: ColumnDef<EventRow, unknown>[] = [
  {
    accessorKey: "name",
    header: "Event Name",
    size: 260,
    enableSorting: true,
    meta: { filterType: "text" } satisfies ColumnMeta,
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
    accessorKey: "chapter",
    header: "Chapter",
    size: 180,
    enableSorting: true,
    meta: { filterType: "text" } satisfies ColumnMeta,
    cell: ({ row }) => (
      <span className="text-sm">{row.original.chapter || "—"}</span>
    ),
  },
  {
    accessorKey: "region",
    header: "Region",
    size: 140,
    enableSorting: true,
    meta: { filterType: "text" } satisfies ColumnMeta,
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">{row.original.region}</span>
    ),
  },
  {
    accessorKey: "location",
    header: "Location",
    size: 180,
    enableSorting: true,
    meta: { filterType: "text" } satisfies ColumnMeta,
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground truncate block max-w-[170px]">
        {row.original.location || "—"}
      </span>
    ),
  },
  {
    accessorKey: "attendees",
    header: "Attendees",
    size: 100,
    enableSorting: true,
    cell: ({ row }) => (
      <span className="tabular-nums text-sm">
        {row.original.attendees > 0 ? row.original.attendees.toLocaleString() : "—"}
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

export function EventList() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("upcoming");
  const [showArchived, setShowArchived] = useState(false);
  const debouncedSearch = useDebounce(search, 300);
  const [view, setView] = useState<ViewMode>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem(STORAGE_KEY) as ViewMode) ?? "table";
    }
    return "table";
  });

  const today = new Date().toISOString().split("T")[0];

  const constraints = useMemo(() => {
    const c = [];
    if (!showArchived) c.push(where("archived", "==", false));
    if (filterMode === "upcoming") {
      c.push(where("startDate", ">=", today));
      c.push(orderBy("startDate", "asc"));
    } else if (filterMode === "past") {
      c.push(where("startDate", "<", today));
      c.push(orderBy("startDate", "desc"));
    } else {
      c.push(orderBy("startDate", "desc"));
    }
    c.push(limit(500));
    return c;
  }, [filterMode, showArchived, today]);

  const { data: events, loading } = useCollection<AppEvent>("events", constraints);
  const data = events as EventRow[];

  // Notify if user toggled archived on but there are no archived events.
  // Use a ref to detect when loading settles after the toggle was turned on.
  const justToggledArchived = useRef(false);
  useEffect(() => {
    if (showArchived) {
      justToggledArchived.current = true;
    } else {
      justToggledArchived.current = false;
    }
  }, [showArchived]);

  useEffect(() => {
    if (justToggledArchived.current && !loading) {
      if (!data.some((e) => e.archived)) {
        toast.info("No archived events", {
          description: "All events in this view are currently active.",
          duration: 3000,
          style: { background: "#eff6ff", borderColor: "#bfdbfe", color: "#1e40af" },
          classNames: { description: "!text-blue-500" },
        });
      }
      justToggledArchived.current = false;
    }
  }, [loading, data]);

  // Cards view still uses client-side filtering
  const filteredForCards = useMemo(() => {
    if (!debouncedSearch) return data;
    const q = debouncedSearch.toLowerCase();
    return data.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.chapter.toLowerCase().includes(q) ||
        e.location?.toLowerCase().includes(q)
    );
  }, [data, debouncedSearch]);

  const handleViewChange = (v: ViewMode) => {
    setView(v);
    localStorage.setItem(STORAGE_KEY, v);
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search events..."
          className="w-full sm:max-w-sm"
        />
        <div className="flex items-center gap-2 flex-wrap">
          {/* Date range pill filter */}
          <div className="inline-flex items-center rounded-full border bg-muted p-1 gap-0.5">
            {(["upcoming", "past", "all"] as FilterMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setFilterMode(mode)}
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
            onClick={() => setShowArchived(!showArchived)}
            className={showArchived ? "text-primary" : "text-muted-foreground"}
          >
            {showArchived ? "Hide Archived" : "Show Archived"}
          </Button>
          <ViewToggle view={view} onViewChange={handleViewChange} />
        </div>
      </div>

      {view === "table" ? (
        <AdvancedDataTable<EventRow>
          columns={columns}
          data={data}
          loading={loading}
          globalFilter={debouncedSearch}
          onRowClick={(event) => router.push(`/events/${event.id}`)}
          emptyTitle="No events found"
          emptyDescription="No events match the current filter"
          emptyIcon={Calendar}
          defaultPageSize={15}
          exportFilename="PNAA_events"
        />
      ) : loading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-48 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : filteredForCards.length === 0 ? (
        <EmptyState
          icon={Calendar}
          title="No events found"
          description={
            search ? "Try adjusting your search" : "No events match the current filter"
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredForCards.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}
