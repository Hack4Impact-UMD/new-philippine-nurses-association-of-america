"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useCollection } from "@/hooks/use-firestore";
import { where, orderBy } from "firebase/firestore";
import { SearchInput } from "@/components/shared/search-input";
import { CampaignCard } from "./campaign-card";
import { EmptyState } from "@/components/shared/empty-state";
import { ViewToggle, type ViewMode } from "@/components/shared/view-toggle";
import {
  AdvancedDataTable,
  type ColumnDef,
  type ColumnMeta,
} from "@/components/shared/advanced-data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DollarSign } from "lucide-react";
import { useDebounce } from "@/hooks/use-debounce";
import { formatDate, formatCurrency } from "@/lib/utils";
import type { FundraisingCampaign } from "@/types/fundraising";

type CampaignRow = FundraisingCampaign & { id: string };

const STORAGE_KEY = "pnaa-fundraising-view";

const columns: ColumnDef<CampaignRow, unknown>[] = [
  {
    accessorKey: "fundraiserName",
    header: "Campaign Name",
    size: 260,
    enableSorting: true,
    meta: { filterType: "text" } satisfies ColumnMeta,
    cell: ({ row }) => (
      <span className="font-medium text-sm">{row.original.fundraiserName}</span>
    ),
  },
  {
    accessorKey: "chapterName",
    header: "Chapter",
    size: 200,
    enableSorting: true,
    meta: { filterType: "text" } satisfies ColumnMeta,
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">{row.original.chapterName}</span>
    ),
  },
  {
    accessorKey: "date",
    header: "Date",
    size: 120,
    enableSorting: true,
    cell: ({ row }) => (
      <span className="text-sm tabular-nums whitespace-nowrap">
        {formatDate(row.original.date)}
      </span>
    ),
  },
  {
    accessorKey: "amount",
    header: "Amount",
    size: 130,
    enableSorting: true,
    cell: ({ row }) => (
      <span className="font-bold text-primary tabular-nums">
        {formatCurrency(row.original.amount)}
      </span>
    ),
  },
  {
    accessorKey: "note",
    header: "Note",
    size: 240,
    enableSorting: false,
    meta: { filterType: "text" } satisfies ColumnMeta,
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground line-clamp-2 leading-snug">
        {row.original.note || "—"}
      </span>
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
        <Badge
          variant="outline"
          className="text-xs text-green-700 border-green-200 bg-green-50 dark:bg-green-950/30"
        >
          Active
        </Badge>
      ),
  },
];

export function CampaignList() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const debouncedSearch = useDebounce(search, 300);
  const [view, setView] = useState<ViewMode>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem(STORAGE_KEY) as ViewMode) ?? "table";
    }
    return "table";
  });

  const constraints = useMemo(() => {
    const c = [];
    if (!showArchived) c.push(where("archived", "==", false));
    c.push(orderBy("date", "desc"));
    return c;
  }, [showArchived]);

  const { data: campaigns, loading } = useCollection<FundraisingCampaign>(
    "fundraising",
    constraints
  );

  const data = campaigns as CampaignRow[];

  const filteredForCards = useMemo(() => {
    if (!debouncedSearch) return data;
    const q = debouncedSearch.toLowerCase();
    return data.filter(
      (c) =>
        c.fundraiserName.toLowerCase().includes(q) ||
        c.chapterName.toLowerCase().includes(q)
    );
  }, [data, debouncedSearch]);

  const totalRaised = data.reduce((sum, c) => sum + c.amount, 0);

  const handleViewChange = (v: ViewMode) => {
    setView(v);
    localStorage.setItem(STORAGE_KEY, v);
  };

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex items-center gap-6 text-sm">
        <div>
          <span className="text-muted-foreground">Total Raised: </span>
          <span className="font-bold text-primary">{formatCurrency(totalRaised)}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Campaigns: </span>
          <span className="font-semibold">{data.length}</span>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search campaigns..."
          className="w-full sm:max-w-sm"
        />
        <div className="flex items-center gap-2">
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
        <AdvancedDataTable<CampaignRow>
          columns={columns}
          data={data}
          loading={loading}
          globalFilter={debouncedSearch}
          onRowClick={(campaign) => router.push(`/fundraising/${campaign.id}`)}
          emptyTitle="No campaigns found"
          emptyDescription="No fundraising campaigns yet"
          emptyIcon={DollarSign}
          defaultPageSize={15}
          exportFilename="PNAA_fundraising_campaigns"
        />
      ) : loading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-40 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : filteredForCards.length === 0 ? (
        <EmptyState
          icon={DollarSign}
          title="No campaigns found"
          description={
            search ? "Try adjusting your search" : "No fundraising campaigns yet"
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredForCards.map((campaign) => (
            <CampaignCard key={campaign.id} campaign={campaign} />
          ))}
        </div>
      )}
    </div>
  );
}
