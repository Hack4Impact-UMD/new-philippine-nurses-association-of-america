"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { SortingState } from "@tanstack/react-table";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { SearchInput } from "@/components/shared/search-input";
import {
  AdvancedDataTable,
  type ColumnDef,
} from "@/components/shared/advanced-data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Users, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useDebounce } from "@/hooks/use-debounce";
import { useChaptersMap } from "@/hooks/use-chapters-map";
import { formatDate } from "@/lib/utils";
import type { Member } from "@/types/member";

type MemberRow = Member & { id: string };

const PAGE_SIZE = 50;

/** Escape LIKE/ILIKE wildcards in user input so a literal "%" doesn't match everything. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export function MemberList() {
  const router = useRouter();
  const { nameFor, canonical } = useChaptersMap();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);

  // Filters + sort are applied server-side: the table only ever holds one
  // page of ~14k members, so client-side table sorting/filtering would act
  // on the visible 50 rows only.
  const [statusFilter, setStatusFilter] = useState<string>("Active");
  const [chapterFilter, setChapterFilter] = useState<string>("all");
  const [regionFilter, setRegionFilter] = useState<string>("all");
  const [sorting, setSorting] = useState<SortingState>([
    { id: "name", desc: false },
  ]);

  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<MemberRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const sort = sorting[0] ?? { id: "name", desc: false };
  const trimmed = debouncedSearch.trim();

  // Any search/filter/sort change restarts from page 0 — done in the event
  // handlers (not an effect) so there's no transient fetch of a stale page.
  const handleSearch = (v: string) => {
    setSearch(v);
    setPage(0);
  };
  const filterSetter =
    (set: (v: string) => void) =>
    (v: string) => {
      set(v);
      setPage(0);
    };
  const handleSortingChange: typeof setSorting = (updater) => {
    setSorting(updater);
    setPage(0);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const supabase = getSupabaseBrowser();
    let q = supabase.from("members").select("*", { count: "exact" });
    if (statusFilter !== "all") q = q.eq("activeStatus", statusFilter);
    if (chapterFilter !== "all") q = q.eq("chapterId", chapterFilter);
    if (regionFilter !== "all") q = q.eq("region", regionFilter);
    if (trimmed.length > 0) {
      // Case-insensitive substring match (Postgres ILIKE). Backed by the
      // (activeStatus, name) index for the common active-only case.
      q = q.ilike("name", `%${escapeLike(trimmed)}%`);
    }

    q.order(sort.id, { ascending: !sort.desc })
      .order("id", { ascending: true }) // stable tiebreaker across pages
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      .then(({ data, count, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("Failed to load members", error);
          setRows([]);
          setTotal(null);
        } else {
          setRows(
            (data ?? []).map((d: Record<string, unknown>) => ({
              ...(d as unknown as Member),
              id: String(d.id),
            }))
          );
          setTotal(count ?? null);
        }
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [page, trimmed, statusFilter, chapterFilter, regionFilter, sort.id, sort.desc]);

  const chapters = useMemo(
    () => [...canonical].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")),
    [canonical]
  );
  const regions = useMemo(
    () =>
      Array.from(
        new Set(canonical.map((c) => c.region).filter((r): r is string => !!r))
      ).sort(),
    [canonical]
  );

  const columns: ColumnDef<MemberRow, unknown>[] = useMemo(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        size: 220,
        enableSorting: true,
        cell: ({ row }) => (
          <span className="font-medium text-sm">{row.original.name}</span>
        ),
      },
      {
        accessorKey: "email",
        header: "Email",
        size: 240,
        enableSorting: true,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.email}
          </span>
        ),
      },
      {
        accessorKey: "chapterId",
        header: "Chapter",
        size: 220,
        // Sorting would order by the chapter slug, not the display name —
        // use the chapter filter instead.
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-sm">{nameFor(row.original.chapterId) || "—"}</span>
        ),
      },
      {
        accessorKey: "region",
        header: "Region",
        size: 140,
        enableSorting: true,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.region}
          </span>
        ),
      },
      {
        accessorKey: "membershipLevel",
        header: "Level",
        size: 160,
        enableSorting: true,
        cell: ({ row }) => (
          <span className="text-sm">{row.original.membershipLevel}</span>
        ),
      },
      {
        accessorKey: "renewalDueDate",
        header: "Renewal Date",
        size: 130,
        enableSorting: true,
        cell: ({ row }) => (
          <span className="text-sm">
            {formatDate(row.original.renewalDueDate)}
          </span>
        ),
      },
      {
        accessorKey: "activeStatus",
        header: "Status",
        size: 100,
        enableSorting: true,
        cell: ({ row }) => (
          <StatusBadge
            variant={
              row.original.activeStatus === "Active" ? "active" : "lapsed"
            }
          />
        ),
      },
    ],
    [nameFor]
  );

  const isSearching = trimmed.length > 0;
  const hasFilters =
    statusFilter !== "Active" || chapterFilter !== "all" || regionFilter !== "all";
  const pageCount =
    total !== null ? Math.max(1, Math.ceil(total / PAGE_SIZE)) : null;
  const hasMore =
    total !== null ? (page + 1) * PAGE_SIZE < total : rows.length === PAGE_SIZE;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <SearchInput
          value={search}
          onChange={handleSearch}
          placeholder="Search members by name…"
          className="w-full lg:max-w-sm"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Select value={chapterFilter} onValueChange={filterSetter(setChapterFilter)}>
            <SelectTrigger className="h-9 w-[200px] text-sm">
              <SelectValue placeholder="Chapter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All chapters</SelectItem>
              {chapters.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={regionFilter} onValueChange={filterSetter(setRegionFilter)}>
            <SelectTrigger className="h-9 w-[160px] text-sm">
              <SelectValue placeholder="Region" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All regions</SelectItem>
              {regions.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={filterSetter(setStatusFilter)}>
            <SelectTrigger className="h-9 w-[130px] text-sm">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="Active">Active</SelectItem>
              <SelectItem value="Lapsed">Lapsed</SelectItem>
            </SelectContent>
          </Select>
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 gap-1 text-xs text-muted-foreground"
              onClick={() => {
                setStatusFilter("Active");
                setChapterFilter("all");
                setRegionFilter("all");
              }}
            >
              <X className="h-3.5 w-3.5" />
              Reset
            </Button>
          )}
        </div>
      </div>

      <AdvancedDataTable<MemberRow>
        columns={columns}
        data={rows}
        loading={loading}
        manualSorting
        sorting={sorting}
        onSortingChange={handleSortingChange}
        onRowClick={(member) => router.push(`/members/${member.id}`)}
        emptyTitle={
          isSearching || hasFilters ? "No matching members" : "No members"
        }
        emptyDescription={
          isSearching || hasFilters
            ? "Try a different search term or filter"
            : "No members have been synced yet"
        }
        emptyIcon={Users}
        defaultPageSize={PAGE_SIZE}
        exportFilename="PNAA_members"
      />

      <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
        {total !== null && (
          <span className="tabular-nums">
            {total.toLocaleString()} member{total !== 1 ? "s" : ""}
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
