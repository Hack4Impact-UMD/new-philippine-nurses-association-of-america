"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO, startOfMonth } from "date-fns";
import { UserPlus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/shared/search-input";
import {
  MonthRangePicker,
  formatMonthRange,
} from "@/components/shared/month-range-picker";
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
import type {
  MembershipEventKind,
  MembershipEventRow,
} from "@/types/membership-event";
import { ScopeSelect, useViewScope, type ViewScope } from "./scope-select";

type KindFilter = "all" | MembershipEventKind;

const KIND_LABEL: Record<MembershipEventKind, string> = {
  joined: "New",
  renewed: "Renewed",
};

/** First of the month as YYYY-MM-DD — the key the RPC takes. */
function monthKey(d: Date): string {
  return format(startOfMonth(d), "yyyy-MM-dd");
}

/** Matches EARLIEST_START_DATE in scripts/member-joins.ts. */
const EARLIEST_MONTH = "1975-01-01";

/**
 * Who joined or renewed in a range of months, for one national / region /
 * chapter scope. Admins only. Joins go back to each member's Wild Apricot start
 * date (scripts/backfill-member-joins.ts); renewals are recorded from launch
 * onward. The month picker starts at the first recorded month rather than
 * offering months that can only ever be empty.
 */
export function NewRenewedMembers({
  scope: sharedScope,
}: {
  scope?: ViewScope;
}) {
  const router = useRouter();
  const { isLoading: authLoading } = useAuth();
  const isAdmin = useIsAdmin();
  const { nameFor } = useChaptersMap();
  // A parent can share one scope across tools, as the Members page tabs do.
  // Rendered on its own, the card keeps its own scope.
  const ownScope = useViewScope();
  const scope = sharedScope ?? ownScope;

  // An inclusive month range, so several months can be viewed and exported
  // together. The picker always hands back start <= end.
  const [[startMonth, endMonth], setRange] = useState<[string, string]>(() => {
    const now = monthKey(new Date());
    return [now, now];
  });
  const [kind, setKind] = useState<KindFilter>("all");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);

  const [rows, setRows] = useState<MembershipEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [firstRecorded, setFirstRecorded] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !isAdmin) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const supabase = getSupabaseBrowser();
      // One call for the whole range, newest first. Joins reach back decades
      // now, so a range can span hundreds of months.
      const { data, error: err } = await supabase.rpc(
        "member_joins_and_renewals",
        {
          p_month: startMonth,
          p_to_month: endMonth,
          p_scope_type: scope.scopeType,
          p_scope: scope.scope,
        }
      );
      if (cancelled) return;
      if (err) {
        console.error("member_joins_and_renewals RPC failed", err);
        setError(err.message ?? "Couldn't load members.");
        setRows([]);
      } else {
        setError(null);
        setRows((data ?? []) as MembershipEventRow[]);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, isAdmin, startMonth, endMonth, scope.scopeType, scope.scope]);

  // The earliest month anything was recorded: usually the oldest backfilled
  // Wild Apricot start date. RLS limits this to members the caller can see,
  // so a chapter admin's picker starts at their own chapter's oldest join.
  useEffect(() => {
    if (authLoading || !isAdmin) return;
    let cancelled = false;
    void (async () => {
      const supabase = getSupabaseBrowser();
      const { data } = await supabase
        .from("membership_events")
        .select("eventMonth")
        .order("eventMonth", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      const row = data as { eventMonth?: string } | null;
      if (row?.eventMonth) setFirstRecorded(row.eventMonth);
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, isAdmin]);

  // The picker spans the first recorded month to this month. Never before
  // EARLIEST_MONTH, the oldest start date the backfill accepts, so one bad
  // date can't offer a picker reaching back to year 1.
  const maxMonth = monthKey(new Date());
  const minMonth = (() => {
    if (!firstRecorded) return maxMonth;
    const first = monthKey(parseISO(firstRecorded));
    if (first > maxMonth) return maxMonth;
    return first < EARLIEST_MONTH ? EARLIEST_MONTH : first;
  })();

  const counts = useMemo(
    () => ({
      joined: rows.filter((r) => r.kind === "joined").length,
      renewed: rows.filter((r) => r.kind === "renewed").length,
    }),
    [rows]
  );

  const visibleRows = useMemo(
    () => (kind === "all" ? rows : rows.filter((r) => r.kind === kind)),
    [rows, kind]
  );

  const columns: ColumnDef<MembershipEventRow, unknown>[] = useMemo(
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
        id: "type",
        header: "Type",
        size: 100,
        enableSorting: true,
        accessorFn: (r) => KIND_LABEL[r.kind],
        cell: ({ row }) => (
          <Badge
            variant={row.original.kind === "joined" ? "default" : "secondary"}
          >
            {KIND_LABEL[row.original.kind]}
          </Badge>
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
        id: "date",
        header: "Date",
        size: 120,
        enableSorting: true,
        accessorFn: (r) => format(parseISO(r.occurredAt), "yyyy-MM-dd"),
        cell: ({ row }) => (
          <span className="text-sm tabular-nums whitespace-nowrap">
            {format(parseISO(row.original.occurredAt), "MMM d, yyyy")}
          </span>
        ),
      },
    ],
    [nameFor]
  );

  if (!authLoading && !isAdmin) return null;

  const monthLabel = formatMonthRange(startMonth, endMonth);
  const fileMonths =
    startMonth === endMonth
      ? startMonth.slice(0, 7)
      : `${startMonth.slice(0, 7)}_to_${endMonth.slice(0, 7)}`;
  const slug = scope.label.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="text-base">New &amp; Renewed Members</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* One control row, above everything it scopes. */}
        <div className="flex flex-wrap items-center gap-2">
          <ScopeSelect scope={scope} />

          <MonthRangePicker
            from={startMonth}
            to={endMonth}
            min={minMonth}
            max={maxMonth}
            onChange={(from, to) => setRange([from, to])}
          />

          <div className="flex items-center gap-1">
            {(
              [
                ["all", `All ${rows.length}`],
                ["joined", `New ${counts.joined}`],
                ["renewed", `Renewed ${counts.renewed}`],
              ] as [KindFilter, string][]
            ).map(([value, text]) => (
              <Button
                key={value}
                variant={kind === value ? "default" : "outline"}
                size="sm"
                className="h-9 text-xs tabular-nums"
                onClick={() => setKind(value)}
                aria-pressed={kind === value}
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
          <AdvancedDataTable<MembershipEventRow>
            columns={columns}
            data={visibleRows}
            loading={loading}
            globalFilter={debouncedSearch}
            getRowId={(r) => `${r.memberId}-${r.kind}-${r.occurredAt}`}
            onRowClick={(r) => router.push(`/members/${r.memberId}`)}
            emptyIcon={UserPlus}
            emptyTitle={`No ${
              kind === "all" ? "new or renewed" : KIND_LABEL[kind].toLowerCase()
            } members for ${monthLabel}`}
            emptyDescription={
              firstRecorded
                ? `${scope.label}. New members are listed by their Wild Apricot start date; renewals are recorded from launch onward.`
                : "Joins and renewals are recorded from launch onward, so this list fills in as they happen."
            }
            defaultPageSize={25}
            exportFilename={`PNAA_new_renewed_${slug}_${fileMonths}`}
          />
        )}
      </CardContent>
    </Card>
  );
}
