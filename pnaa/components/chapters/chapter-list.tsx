"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useCollection } from "@/hooks/use-firestore";
import { useIsNationalAdmin, useIsRegionAdmin } from "@/hooks/use-auth";
import { orderBy } from "firebase/firestore";
import { SearchInput } from "@/components/shared/search-input";
import { ChapterCard } from "./chapter-card";
import { EmptyState } from "@/components/shared/empty-state";
import { ViewToggle, type ViewMode } from "@/components/shared/view-toggle";
import {
  AdvancedDataTable,
  type ColumnDef,
  type ColumnMeta,
} from "@/components/shared/advanced-data-table";
import { Badge } from "@/components/ui/badge";
import { Building2, GitMerge } from "lucide-react";
import { useDebounce } from "@/hooks/use-debounce";
import type { Chapter } from "@/types/chapter";
import type { ChapterAlias } from "@/types/chapter-alias";

type ChapterRow = Chapter & { id: string };

const STORAGE_KEY = "pnaa-chapters-view";

export function ChapterList() {
  const router = useRouter();
  const isNationalAdmin = useIsNationalAdmin();
  const isRegionAdmin = useIsRegionAdmin();
  const canManageAliases = isNationalAdmin || isRegionAdmin;

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [view, setView] = useState<ViewMode>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem(STORAGE_KEY) as ViewMode) ?? "table";
    }
    return "table";
  });

  const { data: chapters, loading } = useCollection<Chapter>("chapters", [
    orderBy("name", "asc"),
  ]);

  // Load all aliases to know which chapter names to hide from the list
  const { data: allAliases } = useCollection<ChapterAlias>("chapter_aliases", []);

  const aliasedNames = useMemo(
    () => new Set((allAliases as (ChapterAlias & { id: string })[]).map((a) => a.aliasName)),
    [allAliases]
  );

  // Filter out chapters whose name is an alias of another chapter
  const visibleChapters = useMemo(
    () => (chapters as ChapterRow[]).filter((c) => !aliasedNames.has(c.name)),
    [chapters, aliasedNames]
  );

  // Lookup maps for merged stats
  const chapterByName = useMemo(
    () => new Map((chapters as ChapterRow[]).map((c) => [c.name, c])),
    [chapters]
  );
  const aliasesByChapterId = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const alias of allAliases as (ChapterAlias & { id: string })[]) {
      const existing = map.get(alias.chapterId) ?? [];
      map.set(alias.chapterId, [...existing, alias.aliasName]);
    }
    return map;
  }, [allAliases]);

  // Visible chapters with stats summed from their aliases
  const mergedChapters = useMemo(
    () =>
      visibleChapters.map((chapter) => {
        const aliasNames = aliasesByChapterId.get(chapter.id) ?? [];
        if (aliasNames.length === 0) return chapter;
        const extra = aliasNames.reduce(
          (acc, name) => {
            const ac = chapterByName.get(name);
            if (!ac) return acc;
            return {
              totalMembers: acc.totalMembers + ac.totalMembers,
              totalActive: acc.totalActive + ac.totalActive,
              totalLapsed: acc.totalLapsed + ac.totalLapsed,
            };
          },
          { totalMembers: 0, totalActive: 0, totalLapsed: 0 },
        );
        return {
          ...chapter,
          totalMembers: chapter.totalMembers + extra.totalMembers,
          totalActive: chapter.totalActive + extra.totalActive,
          totalLapsed: chapter.totalLapsed + extra.totalLapsed,
        };
      }),
    [visibleChapters, aliasesByChapterId, chapterByName]
  );

  const columns: ColumnDef<ChapterRow, unknown>[] = useMemo(
    () => [
      {
        accessorKey: "name",
        header: "Chapter Name",
        size: 280,
        enableSorting: true,
        meta: { filterType: "text" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5">
            <div className="rounded-md bg-primary/10 p-1.5 shrink-0">
              <Building2 className="h-3.5 w-3.5 text-primary" />
            </div>
            <span className="font-medium text-sm">{row.original.name}</span>
          </div>
        ),
      },
      {
        accessorKey: "region",
        header: "Region",
        size: 160,
        enableSorting: true,
        meta: { filterType: "text" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.region}
          </span>
        ),
      },
      {
        accessorKey: "totalMembers",
        header: "Total Members",
        size: 130,
        enableSorting: true,
        meta: { filterType: "numeric" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="font-semibold tabular-nums">
            {row.original.totalMembers.toLocaleString()}
          </span>
        ),
      },
      {
        accessorKey: "totalActive",
        header: "Active",
        size: 100,
        enableSorting: true,
        meta: { filterType: "numeric" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <Badge
            variant="outline"
            className="text-green-700 border-green-200 bg-green-50 dark:bg-green-950/30 dark:border-green-900 font-semibold tabular-nums"
          >
            {row.original.totalActive.toLocaleString()}
          </Badge>
        ),
      },
      {
        accessorKey: "totalLapsed",
        header: "Lapsed",
        size: 100,
        enableSorting: true,
        meta: { filterType: "numeric" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <Badge
            variant="outline"
            className="text-amber-700 border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 font-semibold tabular-nums"
          >
            {row.original.totalLapsed.toLocaleString()}
          </Badge>
        ),
      },
      {
        id: "activeRate",
        header: "Active Rate",
        size: 140,
        enableSorting: true,
        meta: { filterType: "numeric" } satisfies ColumnMeta,
        accessorFn: (row) =>
          row.totalMembers > 0
            ? Math.round((row.totalActive / row.totalMembers) * 100)
            : 0,
        cell: ({ row }) => {
          const rate =
            row.original.totalMembers > 0
              ? Math.round(
                  (row.original.totalActive / row.original.totalMembers) * 100
                )
              : 0;
          return (
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden shrink-0">
                <div
                  className="h-full rounded-full bg-green-500"
                  style={{ width: `${rate}%` }}
                />
              </div>
              <span className="text-xs font-medium tabular-nums">{rate}%</span>
            </div>
          );
        },
      },
    ],
    []
  );

  const filteredForCards = useMemo(() => {
    if (!debouncedSearch) return mergedChapters;
    const q = debouncedSearch.toLowerCase();
    return mergedChapters.filter(
      (c) =>
        c.name.toLowerCase().includes(q) || c.region.toLowerCase().includes(q)
    );
  }, [mergedChapters, debouncedSearch]);

  const handleViewChange = (v: ViewMode) => {
    setView(v);
    localStorage.setItem(STORAGE_KEY, v);
  };

  const hiddenCount = (chapters as ChapterRow[]).length - visibleChapters.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search chapters by name or region..."
            className="w-full sm:max-w-sm"
          />
          {hiddenCount > 0 && (
            <span className="text-xs text-muted-foreground whitespace-nowrap flex items-center gap-1">
              <GitMerge className="h-3 w-3" />
              {hiddenCount} aliased
            </span>
          )}
        </div>
        <ViewToggle view={view} onViewChange={handleViewChange} />
      </div>

      {view === "table" ? (
        <AdvancedDataTable<ChapterRow>
          columns={columns}
          data={mergedChapters}
          loading={loading}
          globalFilter={debouncedSearch}
          onRowClick={(chapter) => router.push(`/chapters/${chapter.id}`)}
          emptyTitle="No chapters found"
          emptyDescription="No chapters are available"
          emptyIcon={Building2}
          defaultPageSize={20}
          defaultColumnFilters={[
            { id: "totalActive", value: { op: ">", value: 0 } },
          ]}
          exportFilename="PNAA_chapters"
        />
      ) : loading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-32 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : filteredForCards.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No chapters found"
          description={
            search ? "Try adjusting your search" : "No chapters available"
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredForCards.map((chapter) => (
            <ChapterCard
              key={chapter.id}
              chapter={chapter}
              showAliasButton={canManageAliases}
            />
          ))}
        </div>
      )}
    </div>
  );
}
