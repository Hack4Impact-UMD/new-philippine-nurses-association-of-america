"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentSnapshot,
  type QueryConstraint,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { SearchInput } from "@/components/shared/search-input";
import {
  AdvancedDataTable,
  type ColumnDef,
} from "@/components/shared/advanced-data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Users, ChevronLeft, ChevronRight } from "lucide-react";
import { useDebounce } from "@/hooks/use-debounce";
import { formatDate } from "@/lib/utils";
import type { Member } from "@/types/member";

type MemberRow = Member & { id: string };

const PAGE_SIZE = 50;
const MIN_SEARCH = 2;

const titleCase = (s: string) =>
  s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

export function MemberList() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [activeOnly, setActiveOnly] = useState(true);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);

  // Cursors live in a ref so saving the next-page cursor doesn't retrigger the
  // fetch effect. cursors[i] is the startAfter cursor used to fetch page i.
  const cursorsRef = useRef<(DocumentSnapshot | null)[]>([null]);

  // Reset paging when filter/search changes.
  useEffect(() => {
    cursorsRef.current = [null];
    setPage(0);
  }, [debouncedSearch, activeOnly]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const trimmed = debouncedSearch.trim();
    const isSearching = trimmed.length >= MIN_SEARCH;

    const constraints: QueryConstraint[] = [];
    if (activeOnly) constraints.push(where("activeStatus", "==", "Active"));
    if (isSearching) {
      const prefix = titleCase(trimmed);
      constraints.push(where("name", ">=", prefix));
      constraints.push(where("name", "<", prefix + ""));
    }
    constraints.push(orderBy("name"));
    const startCursor = cursorsRef.current[page] ?? null;
    if (startCursor) constraints.push(startAfter(startCursor));
    constraints.push(fsLimit(PAGE_SIZE + 1)); // +1 to detect "more"

    getDocs(query(collection(db, "members"), ...constraints))
      .then((snap) => {
        if (cancelled) return;
        const docs = snap.docs;
        const more = docs.length > PAGE_SIZE;
        const pageDocs = more ? docs.slice(0, PAGE_SIZE) : docs;
        setRows(
          pageDocs.map((d) => ({ ...(d.data() as Member), id: d.id }))
        );
        setHasMore(more);
        if (more) {
          cursorsRef.current[page + 1] = pageDocs[pageDocs.length - 1];
        }
      })
      .catch((err) => {
        if (!cancelled) console.error("Failed to load members", err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [page, debouncedSearch, activeOnly]);

  const columns: ColumnDef<MemberRow, unknown>[] = useMemo(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        size: 220,
        enableSorting: false,
        cell: ({ row }) => (
          <span className="font-medium text-sm">{row.original.name}</span>
        ),
      },
      {
        accessorKey: "email",
        header: "Email",
        size: 240,
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.email}
          </span>
        ),
      },
      {
        accessorKey: "chapterName",
        header: "Chapter",
        size: 220,
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-sm">{row.original.chapterName || "—"}</span>
        ),
      },
      {
        accessorKey: "region",
        header: "Region",
        size: 140,
        enableSorting: false,
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
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-sm">{row.original.membershipLevel}</span>
        ),
      },
      {
        accessorKey: "renewalDueDate",
        header: "Renewal Date",
        size: 130,
        enableSorting: false,
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
        enableSorting: false,
        cell: ({ row }) => (
          <StatusBadge
            variant={
              row.original.activeStatus === "Active" ? "active" : "lapsed"
            }
          />
        ),
      },
    ],
    []
  );

  const trimmed = debouncedSearch.trim();
  const isSearching = trimmed.length >= MIN_SEARCH;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={`Search by name (≥ ${MIN_SEARCH} chars)…`}
          className="w-full sm:max-w-md"
        />
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={activeOnly} onCheckedChange={setActiveOnly} />
          <span className="text-muted-foreground">Active only</span>
        </label>
      </div>

      {!isSearching && search.trim().length > 0 && (
        <p className="text-xs text-muted-foreground">
          Type at least {MIN_SEARCH} letters to filter results.
        </p>
      )}

      <AdvancedDataTable<MemberRow>
        columns={columns}
        data={rows}
        loading={loading}
        onRowClick={(member) => router.push(`/members/${member.id}`)}
        emptyTitle={
          isSearching ? "No matching members" : "No members"
        }
        emptyDescription={
          isSearching
            ? "Try a different search prefix"
            : activeOnly
              ? "No active members on this page"
              : "No members on this page"
        }
        emptyIcon={Users}
        defaultPageSize={PAGE_SIZE}
        exportFilename="PNAA_members"
      />

      <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
        <span className="tabular-nums">Page {page + 1}</span>
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
