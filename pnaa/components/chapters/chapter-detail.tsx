"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  useDocument,
  useCollection,
  useCollectionOnce,
} from "@/hooks/use-firestore";
import { useIsNationalAdmin, useIsRegionAdmin } from "@/hooks/use-auth";
import { where, orderBy } from "@/lib/supabase/firestore";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AdvancedDataTable,
  type ColumnDef,
  type ColumnMeta,
} from "@/components/shared/advanced-data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { EventCard } from "@/components/events/event-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Users, Building2, GitMerge, Settings2 } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { parseISO, subYears, isAfter } from "date-fns";
import { SubchapterList } from "@/components/subchapters/subchapter-list";
import { ChapterInsights } from "@/components/chapters/chapter-insights";
import type { Chapter } from "@/types/chapter";
import type { ChapterAlias } from "@/types/chapter-alias";
import type { Member } from "@/types/member";
import type { AppEvent } from "@/types/event";
import type { FundraisingCampaign } from "@/types/fundraising";

type MemberRow = Member & { id: string };
type AliasRow = ChapterAlias & { id: string };

const memberColumns: ColumnDef<MemberRow, unknown>[] = [
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
      <span className="text-sm text-muted-foreground">{row.original.email}</span>
    ),
  },
  {
    accessorKey: "membershipLevel",
    header: "Level",
    size: 150,
    enableSorting: true,
    meta: { filterType: "text" } satisfies ColumnMeta,
    cell: ({ row }) => (
      <span className="text-sm">{row.original.membershipLevel}</span>
    ),
  },
  {
    accessorKey: "highestEducation",
    header: "Education",
    size: 160,
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {row.original.highestEducation}
      </span>
    ),
  },
  {
    accessorKey: "renewalDueDate",
    header: "Renewal Date",
    size: 130,
    enableSorting: true,
    cell: ({ row }) => (
      <span className="text-sm">{formatDate(row.original.renewalDueDate)}</span>
    ),
  },
  {
    accessorKey: "activeStatus",
    header: "Status",
    size: 100,
    enableSorting: true,
    meta: {
      filterType: "select",
      filterOptions: [
        { label: "Active", value: "Active" },
        { label: "Lapsed", value: "Lapsed" },
      ],
    } satisfies ColumnMeta,
    cell: ({ row }) => (
      <StatusBadge
        variant={row.original.activeStatus === "Active" ? "active" : "lapsed"}
      />
    ),
  },
];

export function ChapterDetail({ chapterId }: { chapterId: string }) {
  const isNationalAdmin = useIsNationalAdmin();
  const isRegionAdmin = useIsRegionAdmin();
  const canManageAliases = isNationalAdmin || isRegionAdmin;

  const { data: chapter, loading: chapterLoading } = useDocument<Chapter>(
    "chapters",
    chapterId
  );

  // Aliases now collapse to the same canonical chapterId during sync, so
  // they're surfaced for display / management only, not used as filter keys.
  const aliasConstraints = useMemo(
    () => [where("chapterId", "==", chapterId)],
    [chapterId]
  );
  const { data: aliases } = useCollectionOnce<ChapterAlias>(
    "chapter_aliases",
    aliasConstraints
  );
  const hasAliases = (aliases as AliasRow[]).length > 0;

  const memberConstraints = useMemo(
    () => [where("chapterId", "==", chapterId), orderBy("name", "asc")],
    [chapterId]
  );

  const eventConstraints = useMemo(
    () => [
      where("chapterId", "==", chapterId),
      where("archived", "==", false),
      orderBy("startDate", "desc"),
    ],
    [chapterId]
  );

  const fundraisingConstraints = useMemo(
    () => [
      where("chapterId", "==", chapterId),
      where("archived", "==", false),
      orderBy("date", "desc"),
    ],
    [chapterId]
  );

  const [showAllMembers, setShowAllMembers] = useState(false);

  const { data: members, loading: membersLoading } = useCollectionOnce<Member>(
    "members",
    chapterId ? memberConstraints : []
  );

  const filteredMembers = useMemo((): MemberRow[] => {
    const rows = members as MemberRow[];
    if (showAllMembers) return rows;
    const cutoff = subYears(new Date(), 3);
    return rows.filter(
      (m) =>
        m.activeStatus === "Active" ||
        (m.renewalDueDate && isAfter(parseISO(m.renewalDueDate), cutoff))
    );
  }, [members, showAllMembers]);

  // Live stats derived from loaded members (accurate with aliases)
  const liveStats = useMemo(() => {
    if (membersLoading) return null;
    const total = members.length;
    const active = (members as MemberRow[]).filter(
      (m) => m.activeStatus === "Active"
    ).length;
    return { total, active, lapsed: total - active };
  }, [members, membersLoading]);

  const { data: events, loading: eventsLoading } = useCollection<AppEvent>(
    "events",
    chapterId ? eventConstraints : []
  );

  const { data: campaigns, loading: campaignsLoading } =
    useCollection<FundraisingCampaign>(
      "fundraising",
      chapterId ? fundraisingConstraints : []
    );

  if (chapterLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!chapter) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold">Chapter not found</h2>
        <Link
          href="/chapters"
          className="text-primary hover:underline mt-2 inline-block"
        >
          Back to chapters
        </Link>
      </div>
    );
  }

  const displayTotal = liveStats?.total ?? chapter.totalMembers;
  const displayActive = liveStats?.active ?? chapter.totalActive;
  const displayLapsed = liveStats?.lapsed ?? chapter.totalLapsed;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-3">
            <Building2 className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{chapter.name}</h1>
            <p className="text-muted-foreground">{chapter.region}</p>
            {hasAliases && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {(aliases as AliasRow[]).map((alias) => (
                  <Badge
                    key={alias.id}
                    variant="outline"
                    className="text-xs font-normal gap-1 text-muted-foreground"
                  >
                    <GitMerge className="h-2.5 w-2.5" />
                    {alias.aliasName}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
        {canManageAliases && (
          <Link href={`/chapters/${chapterId}/aliases`}>
            <Button variant="outline" size="sm">
              <Settings2 className="h-4 w-4 mr-2" />
              Manage Aliases
            </Button>
          </Link>
        )}
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <Users className="h-5 w-5 text-primary" />
            <div>
              <p className="text-2xl font-bold">{displayTotal}</p>
              <p className="text-xs text-muted-foreground">Total Members</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <Users className="h-5 w-5 text-green-600" />
            <div>
              <p className="text-2xl font-bold">{displayActive}</p>
              <p className="text-xs text-muted-foreground">Active Members</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <Users className="h-5 w-5 text-amber-600" />
            <div>
              <p className="text-2xl font-bold">{displayLapsed}</p>
              <p className="text-xs text-muted-foreground">Lapsed Members</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Insights */}
      <ChapterInsights
        members={members as MemberRow[]}
        events={events as (AppEvent & { id: string })[]}
        loading={membersLoading || eventsLoading}
      />

      {/* Tabs */}
      <Tabs defaultValue="members">
        <div className="flex items-center gap-3">
          <TabsList>
            <TabsTrigger value="members">Members</TabsTrigger>
            <TabsTrigger value="events">Events</TabsTrigger>
            <TabsTrigger value="fundraising">Fundraising</TabsTrigger>
          </TabsList>
          <TabsList>
            <TabsTrigger value="subchapters">Subchapters</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="members" className="mt-4">
          <div className="flex justify-end mb-2">
            <Button
              variant={showAllMembers ? "default" : "outline"}
              size="sm"
              className="text-xs h-7"
              onClick={() => setShowAllMembers((v) => !v)}
            >
              {showAllMembers ? "Showing all members" : "Show old lapsed"}
            </Button>
          </div>
          <AdvancedDataTable<MemberRow>
            columns={memberColumns}
            data={filteredMembers}
            loading={membersLoading}
            emptyTitle="No members found"
            emptyDescription="No members are assigned to this chapter"
          />
        </TabsContent>

        <TabsContent value="events" className="mt-4">
          {eventsLoading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-48" />
              ))}
            </div>
          ) : events.length === 0 ? (
            <EmptyState
              title="No events"
              description="No events found for this chapter"
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {events.map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="fundraising" className="mt-4">
          {campaignsLoading ? (
            <Skeleton className="h-48" />
          ) : campaigns.length === 0 ? (
            <EmptyState
              title="No campaigns"
              description="No fundraising campaigns for this chapter"
            />
          ) : (
            <div className="space-y-3">
              {campaigns.map((campaign) => (
                <Link
                  key={campaign.id}
                  href={`/fundraising/${campaign.id}`}
                  className="block"
                >
                  <Card className="hover:shadow-md transition-shadow">
                    <CardContent className="pt-4 pb-4 flex items-center justify-between">
                      <div>
                        <p className="font-medium">{campaign.fundraiserName}</p>
                        <p className="text-sm text-muted-foreground">
                          {formatDate(campaign.date)}
                        </p>
                      </div>
                      <p className="text-lg font-bold text-primary">
                        ${campaign.amount.toLocaleString()}
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="subchapters" className="mt-4">
          <SubchapterList chapterId={chapterId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
