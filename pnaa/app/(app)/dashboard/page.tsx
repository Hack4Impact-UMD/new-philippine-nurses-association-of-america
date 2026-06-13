"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Plus, HandCoins } from "lucide-react";
import { useCollection } from "@/hooks/use-firestore";
import {
  useAuth,
  useIsNationalAdmin,
  useIsRegionAdmin,
  useIsAdmin,
  useUserChapter,
  useUserRegion,
} from "@/hooks/use-auth";
import {
  where,
  orderBy,
  limit,
  type QueryConstraint,
} from "@/lib/supabase/firestore";
import { useDashboardStats } from "@/hooks/use-dashboard-stats";
import { useChaptersMap } from "@/hooks/use-chapters-map";
import { StatsCards } from "@/components/dashboard/stats-cards";
import { ChapterListWidget } from "@/components/dashboard/chapter-list-widget";
import { UpcomingEvents } from "@/components/dashboard/upcoming-events";
import { RecentFundraising } from "@/components/dashboard/recent-fundraising";
import { RegionChart } from "@/components/dashboard/region-chart";
import { SyncStatusCard } from "@/components/dashboard/sync-status-card";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { cn, stripChapterPrefix } from "@/lib/utils";
import type { Chapter } from "@/types/chapter";
import type { AppEvent } from "@/types/event";
import type { FundraisingCampaign } from "@/types/fundraising";

function greetingFor(date: Date): string {
  const h = date.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function DashboardPage() {
  const { user } = useAuth();
  const isNationalAdmin = useIsNationalAdmin();
  const isRegionAdmin = useIsRegionAdmin();
  const isAdmin = useIsAdmin();
  const userChapter = useUserChapter();
  const userRegion = useUserRegion();
  const { nameFor, regionFor } = useChaptersMap();
  const { stats, loading: statsLoading } = useDashboardStats();

  const today = new Date().toISOString().split("T")[0];

  // National/region admins see the org or region; everyone else is chapter-scoped.
  const chapterScoped = !isNationalAdmin && !isRegionAdmin && !!userChapter;

  const { data: chapters } = useCollection<Chapter>("chapters");

  // Events: chapter-scope filters in the query; region-scope fetches a wider
  // window and filters client-side (events carry no region column).
  const eventConstraints = useMemo(() => {
    const c: QueryConstraint[] = [
      where("archived", "==", false),
      where("startDate", ">=", today),
    ];
    if (chapterScoped && userChapter) {
      c.push(where("chapterId", "==", userChapter));
    }
    c.push(orderBy("startDate", "asc"), limit(chapterScoped ? 6 : 25));
    return c;
  }, [today, chapterScoped, userChapter]);
  const { data: upcomingEventsRaw } = useCollection<AppEvent>(
    "events",
    eventConstraints
  );

  const campaignConstraints = useMemo(() => {
    const c: QueryConstraint[] = [where("archived", "==", false)];
    if (chapterScoped && userChapter) {
      c.push(where("chapterId", "==", userChapter));
    }
    c.push(orderBy("date", "desc"), limit(chapterScoped ? 6 : 25));
    return c;
  }, [chapterScoped, userChapter]);
  const { data: campaignsRaw } = useCollection<FundraisingCampaign>(
    "fundraising",
    campaignConstraints
  );

  // Region admins: filter events/campaigns down to chapters in their region.
  const upcomingEvents = useMemo(() => {
    let list = upcomingEventsRaw;
    if (isRegionAdmin && userRegion) {
      list = list.filter((e) => regionFor(e.chapterId) === userRegion);
    }
    return list.slice(0, 6);
  }, [upcomingEventsRaw, isRegionAdmin, userRegion, regionFor]);

  const campaigns = useMemo(() => {
    let list = campaignsRaw;
    if (isRegionAdmin && userRegion) {
      list = list.filter((c) => regionFor(c.chapterId) === userRegion);
    }
    return list.slice(0, 6);
  }, [campaignsRaw, isRegionAdmin, userRegion, regionFor]);

  // Chapter list (national: all; region: their region only).
  const scopedChapters = useMemo(() => {
    if (isRegionAdmin && userRegion) {
      return chapters.filter((c) => c.region === userRegion);
    }
    return chapters;
  }, [chapters, isRegionAdmin, userRegion]);

  const showOrgWidgets = isNationalAdmin || isRegionAdmin;

  const firstName = user?.displayName?.trim().split(/\s+/)[0] || "there";
  const scopeLabel = isNationalAdmin
    ? "National overview"
    : isRegionAdmin && userRegion
      ? `${userRegion} region`
      : userChapter
        ? `${stripChapterPrefix(nameFor(userChapter, "Your chapter"))} chapter`
        : "Your overview";

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${greetingFor(new Date())}, ${firstName}`}
        description={scopeLabel}
      >
        {isAdmin && (
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/fundraising/new">
                <HandCoins className="h-4 w-4" />
                New Fundraiser
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/events/new">
                <Plus className="h-4 w-4" />
                New Event
              </Link>
            </Button>
          </>
        )}
      </PageHeader>

      <StatsCards stats={stats} loading={statsLoading} />

      {showOrgWidgets ? (
        <>
          <div className="grid items-start gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <ChapterListWidget chapters={scopedChapters} />
            </div>
            <RegionChart regions={stats?.regions ?? []} loading={statsLoading} />
          </div>
          <div
            className={cn(
              "grid items-start gap-6",
              isNationalAdmin ? "lg:grid-cols-3" : "lg:grid-cols-2"
            )}
          >
            <UpcomingEvents events={upcomingEvents} />
            <RecentFundraising campaigns={campaigns} />
            {isNationalAdmin && <SyncStatusCard />}
          </div>
        </>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <UpcomingEvents events={upcomingEvents} />
          <RecentFundraising campaigns={campaigns} />
        </div>
      )}
    </div>
  );
}
