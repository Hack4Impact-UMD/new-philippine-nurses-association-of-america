"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useDocument, useCollection } from "@/hooks/use-firestore";
import { where, orderBy } from "firebase/firestore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable, type Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { EventCard } from "@/components/events/event-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Users, Building2 } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { SubchapterList } from "@/components/subchapters/subchapter-list";
import type { Chapter } from "@/types/chapter";
import type { Member } from "@/types/member";
import type { AppEvent } from "@/types/event";
import type { FundraisingCampaign } from "@/types/fundraising";

const memberColumns: Column<Member & { id: string }>[] = [
  { key: "name", header: "Name", sortable: true },
  { key: "email", header: "Email", sortable: true },
  { key: "membershipLevel", header: "Level", sortable: true },
  { key: "highestEducation", header: "Education" },
  {
    key: "renewalDueDate",
    header: "Renewal Date",
    sortable: true,
    render: (m) => formatDate(m.renewalDueDate),
  },
  {
    key: "activeStatus",
    header: "Status",
    sortable: true,
    render: (m) => (
      <StatusBadge
        variant={m.activeStatus === "Active" ? "active" : "lapsed"}
      />
    ),
  },
];

export function ChapterDetail({ chapterId }: { chapterId: string }) {
  const { data: chapter, loading: chapterLoading } = useDocument<Chapter>(
    "chapters",
    chapterId
  );

  const memberConstraints = useMemo(
    () => [
      where("chapterName", "==", chapter?.name || ""),
      orderBy("name", "asc"),
    ],
    [chapter?.name]
  );

  const eventConstraints = useMemo(
    () => [
      where("chapter", "==", chapter?.name || ""),
      where("archived", "==", false),
      orderBy("startDate", "desc"),
    ],
    [chapter?.name]
  );

  const fundraisingConstraints = useMemo(
    () => [
      where("chapterName", "==", chapter?.name || ""),
      where("archived", "==", false),
      orderBy("date", "desc"),
    ],
    [chapter?.name]
  );

  const { data: members, loading: membersLoading } = useCollection<Member>(
    "members",
    chapter?.name ? memberConstraints : []
  );

  const { data: events, loading: eventsLoading } = useCollection<AppEvent>(
    "events",
    chapter?.name ? eventConstraints : []
  );

  const { data: campaigns, loading: campaignsLoading } =
    useCollection<FundraisingCampaign>(
      "fundraising",
      chapter?.name ? fundraisingConstraints : []
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-primary/10 p-3">
          <Building2 className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{chapter.name}</h1>
          <p className="text-muted-foreground">{chapter.region}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <Users className="h-5 w-5 text-primary" />
            <div>
              <p className="text-2xl font-bold">{chapter.totalMembers}</p>
              <p className="text-xs text-muted-foreground">Total Members</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <Users className="h-5 w-5 text-green-600" />
            <div>
              <p className="text-2xl font-bold">{chapter.totalActive}</p>
              <p className="text-xs text-muted-foreground">Active Members</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <Users className="h-5 w-5 text-amber-600" />
            <div>
              <p className="text-2xl font-bold">{chapter.totalLapsed}</p>
              <p className="text-xs text-muted-foreground">Lapsed Members</p>
            </div>
          </CardContent>
        </Card>
      </div>

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
          <DataTable
            columns={memberColumns}
            data={members}
            loading={membersLoading}
            emptyMessage="No members found"
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
                        <p className="font-medium">
                          {campaign.fundraiserName}
                        </p>
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
