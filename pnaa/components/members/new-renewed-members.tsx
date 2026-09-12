"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { format, isBefore, parseISO, startOfMonth, subMonths } from "date-fns";
import { UserPlus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import type {
  MembershipEventKind,
  MembershipEventRow,
} from "@/types/membership-event";
import { ScopeSelect, useViewScope } from "./scope-select";

type KindFilter = "all" | MembershipEventKind;

const KIND_LABEL: Record<MembershipEventKind, string> = {
  joined: "New",
  renewed: "Renewed",
};

/** First of the month as YYYY-MM-DD — the key the RPC takes. */
function monthKey(d: Date): string {
  return format(startOfMonth(d), "yyyy-MM-dd");
}

/**
 * Who joined or renewed in a given month, for one national / region / chapter
 * scope. Admins only. Recorded from launch onward, so the month picker starts
 * at the first recorded month rather than offering months that can only ever
 * be empty.
 */
export function NewRenewedMembers() {
  const router = useRouter();
  const { isLoading: authLoading } = useAuth();
  const isAdmin = useIsAdmin();
  const { nameFor } = useChaptersMap();
  const scope = useViewScope();

  const [month, setMonth] = useState(() => monthKey(new Date()));
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
      const { data, error: err } = await supabase.rpc(
        "member_joins_and_renewals",
        {
          p_month: month,
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
  }, [authLoading, isAdmin, month, scope.scopeType, scope.scope]);

  // The earliest month anything was recorded. RLS limits this to members the
  // caller can see, which is fine: recording began at the same time for all.
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

  const monthOptions = useMemo(() => {
    const current = startOfMonth(new Date());
    const earliest = firstRecorded
      ? startOfMonth(parseISO(firstRecorded))
      : current;
    const out: string[] = [];
    // Capped so a bad date can never spin this loop.
    for (let d = current, i = 0; !isBefore(d, earliest) && i < 120; d = subMonths(d, 1), i++) {
      out.push(monthKey(d));
    }
    return out.length > 0 ? out : [monthKey(current)];
  }, [firstRecorded]);

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

  const monthLabel = format(parseISO(month), "MMMM yyyy");
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

          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="h-9 w-[170px] text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {monthOptions.map((m) => (
                <SelectItem key={m} value={m}>
                  {format(parseISO(m), "MMMM yyyy")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

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
            getRowId={(r) => `${r.memberId}-${r.kind}`}
            onRowClick={(r) => router.push(`/members/${r.memberId}`)}
            emptyIcon={UserPlus}
            emptyTitle={`No ${
              kind === "all" ? "new or renewed" : KIND_LABEL[kind].toLowerCase()
            } members for ${monthLabel}`}
            emptyDescription={
              firstRecorded
                ? `${scope.label}. Joins and renewals are recorded as they happen.`
                : "Joins and renewals are recorded from launch onward, so this list fills in as they happen."
            }
            defaultPageSize={25}
            exportFilename={`PNAA_new_renewed_${slug}_${month.slice(0, 7)}`}
          />
        )}
      </CardContent>
    </Card>
  );
}
