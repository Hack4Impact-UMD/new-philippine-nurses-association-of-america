"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { UserMinus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/shared/search-input";
import {
  AdvancedDataTable,
  type ColumnDef,
  type ColumnMeta,
} from "@/components/shared/advanced-data-table";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useAuth, useIsAdmin } from "@/hooks/use-auth";
import { useDebounce } from "@/hooks/use-debounce";
import { useChaptersMap } from "@/hooks/use-chapters-map";
import { stripChapterPrefix } from "@/lib/utils";
import {
  LAPSED_BUCKETS,
  LAPSED_BUCKET_LABEL,
  countByBucket,
  lapsedBucket,
  type LapsedBucket,
} from "@/lib/lapsed";
import type { LapsedMemberRow } from "@/types/membership-event";
import { ScopeSelect, useViewScope, type ViewScope } from "./scope-select";

type BucketFilter = "all" | LapsedBucket;

// Freshest lapses are the likeliest to come back, so they read loudest.
const BUCKET_VARIANT: Record<
  LapsedBucket,
  "default" | "secondary" | "outline" | "destructive"
> = {
  "0-30": "default",
  "31-60": "secondary",
  "61-90": "outline",
  "90+": "destructive",
};

/**
 * Members whose membership has lapsed, grouped by how long ago: within 30 days,
 * 31–60, 61–90 and beyond 90. The counterpart to New & Renewed, for one
 * national / region / chapter scope. Admins only.
 */
export function LapsedMembers({ scope: sharedScope }: { scope?: ViewScope }) {
  const router = useRouter();
  const { isLoading: authLoading } = useAuth();
  const isAdmin = useIsAdmin();
  const { nameFor } = useChaptersMap();
  const ownScope = useViewScope();
  const scope = sharedScope ?? ownScope;

  const [bucket, setBucket] = useState<BucketFilter>("all");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);

  const [rows, setRows] = useState<LapsedMemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !isAdmin) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const supabase = getSupabaseBrowser();
      const { data, error: err } = await supabase.rpc("lapsed_members", {
        p_scope_type: scope.scopeType,
        p_scope: scope.scope,
      });
      if (cancelled) return;
      if (err) {
        console.error("lapsed_members RPC failed", err);
        setError(err.message ?? "Couldn't load members.");
        setRows([]);
      } else {
        setError(null);
        setRows((data ?? []) as LapsedMemberRow[]);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, isAdmin, scope.scopeType, scope.scope]);

  const counts = useMemo(() => countByBucket(rows), [rows]);

  const visibleRows = useMemo(
    () =>
      bucket === "all"
        ? rows
        : rows.filter((r) => lapsedBucket(r.daysLapsed) === bucket),
    [rows, bucket]
  );

  const columns: ColumnDef<LapsedMemberRow, unknown>[] = useMemo(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        size: 200,
        enableSorting: true,
        meta: { filterType: "text" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="font-medium text-sm">{row.original.name}</span>
        ),
      },
      {
        accessorKey: "email",
        header: "Email",
        size: 220,
        enableSorting: true,
        meta: { filterType: "text" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.email}
          </span>
        ),
      },
      {
        id: "chapter",
        header: "Chapter",
        size: 180,
        enableSorting: true,
        meta: { filterType: "text" } satisfies ColumnMeta,
        accessorFn: (r) =>
          stripChapterPrefix(r.chapterName ?? nameFor(r.chapterId, "")),
        cell: ({ getValue }) => (
          <span className="text-sm">{(getValue() as string) || "—"}</span>
        ),
      },
      {
        accessorKey: "region",
        header: "Region",
        size: 150,
        enableSorting: true,
        meta: { filterType: "text" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.region || "—"}
          </span>
        ),
      },
      {
        accessorKey: "membershipLevel",
        header: "Level",
        size: 170,
        enableSorting: true,
        meta: { filterType: "text" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="text-sm">{row.original.membershipLevel}</span>
        ),
      },
      {
        accessorKey: "lapsedOn",
        header: "Lapsed On",
        size: 120,
        enableSorting: true,
        cell: ({ row }) => (
          <span className="text-sm tabular-nums whitespace-nowrap">
            {format(parseISO(row.original.lapsedOn), "MMM d, yyyy")}
          </span>
        ),
      },
      {
        accessorKey: "daysLapsed",
        header: "Lapsed For",
        size: 140,
        enableSorting: true,
        meta: { filterType: "numeric" } satisfies ColumnMeta,
        cell: ({ row }) => {
          const b = lapsedBucket(row.original.daysLapsed);
          return (
            <div className="flex items-center gap-2 whitespace-nowrap">
              <Badge variant={BUCKET_VARIANT[b]}>{LAPSED_BUCKET_LABEL[b]}</Badge>
              <span className="text-xs tabular-nums text-muted-foreground">
                {row.original.daysLapsed}d
              </span>
            </div>
          );
        },
      },
    ],
    [nameFor]
  );

  if (!authLoading && !isAdmin) return null;

  const slug = scope.label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const filterOptions: [BucketFilter, string][] = [
    ["all", `All ${rows.length}`],
    ...LAPSED_BUCKETS.map(
      (b) => [b, `${LAPSED_BUCKET_LABEL[b]} ${counts[b]}`] as [BucketFilter, string]
    ),
  ];

  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="text-base">Lapsed Members</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <ScopeSelect scope={scope} />

          <div
            className="flex flex-wrap items-center gap-1"
            role="group"
            aria-label="Lapsed for"
          >
            {filterOptions.map(([value, text]) => (
              <Button
                key={value}
                variant={bucket === value ? "default" : "outline"}
                size="sm"
                className="h-9 text-xs tabular-nums"
                onClick={() => setBucket(value)}
                aria-pressed={bucket === value}
              >
                {text}
              </Button>
            ))}
          </div>

          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search name or email…"
            className="w-full sm:ml-auto sm:max-w-xs"
          />
        </div>

        {error ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Couldn&apos;t load this list. {error}
          </p>
        ) : (
          <AdvancedDataTable<LapsedMemberRow>
            columns={columns}
            data={visibleRows}
            loading={loading}
            globalFilter={debouncedSearch}
            getRowId={(r) => r.memberId}
            onRowClick={(r) => router.push(`/members/${r.memberId}`)}
            emptyIcon={UserMinus}
            emptyTitle={
              bucket === "all"
                ? "No lapsed members"
                : `No members lapsed ${LAPSED_BUCKET_LABEL[bucket]}`
            }
            emptyDescription={`${scope.label}.`}
            defaultPageSize={25}
            exportFilename={`PNAA_lapsed_${slug}${
              bucket === "all" ? "" : `_${bucket.replace("+", "plus")}`
            }`}
          />
        )}
      </CardContent>
    </Card>
  );
}
