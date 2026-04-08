"use client";

import { useMemo } from "react";
import { useCollection } from "@/hooks/use-firestore";
import { useAuth, useIsNationalAdmin } from "@/hooks/use-auth";
import { where, orderBy, limit } from "firebase/firestore";
import { StatsCards } from "@/components/dashboard/stats-cards";
import { ChapterListWidget } from "@/components/dashboard/chapter-list-widget";
import { UpcomingEvents } from "@/components/dashboard/upcoming-events";
import { FundraisingProgress } from "@/components/dashboard/fundraising-progress";
import { PageHeader } from "@/components/shared/page-header";
import type { Chapter } from "@/types/chapter";
import type { ChapterAlias } from "@/types/chapter-alias";
import type { AppEvent } from "@/types/event";
import type { FundraisingCampaign } from "@/types/fundraising";
import { MembershipTrendsGraph } from "@/components/dashboard/membership-trends-graph"

export default function DashboardPage() {
  const { user } = useAuth();
  const isNationalAdmin = useIsNationalAdmin();
  const today = new Date().toISOString().split("T")[0];

  const { data: chapters } = useCollection<Chapter>("chapters");
  const { data: chapterAliases } = useCollection<ChapterAlias>("chapter_aliases");

  const eventConstraints = useMemo(
    () => [
      where("archived", "==", false),
      where("startDate", ">=", today),
      orderBy("startDate", "asc"),
      limit(5),
    ],
    [today]
  );
  const { data: upcomingEvents } = useCollection<AppEvent>(
    "events",
    eventConstraints
  );
  

  const campaignConstraints = useMemo(
    () => [where("archived", "==", false), orderBy("date", "desc"), limit(5)],
    []
  );
  const { data: campaigns } = useCollection<FundraisingCampaign>(
    "fundraising",
    campaignConstraints
  );

  const stats = useMemo(() => {
    const totalMembers = chapters.reduce((sum, c) => sum + (c.totalMembers ?? 0), 0);
    const activeMembers = chapters.reduce((sum, c) => sum + (c.totalActive ?? 0), 0);
    return {
      totalMembers,
      activeMembers,
      lapsedMembers: totalMembers - activeMembers,
      totalChapters: chapters.length,
      upcomingEvents: upcomingEvents.length,
      totalFundraised: campaigns.reduce((sum, c) => sum + c.amount, 0),
    };
  }, [chapters, upcomingEvents, campaigns]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          isNationalAdmin
            ? "National Dashboard"
            : `${user?.chapterName || "Chapter"} Dashboard`
        }
        description="The Philippine Nurses Association of America represents 65 chapters with over 13,000+ members. We uphold the positive image and welfare of Filipino-American nurses, promote professional excellence, and contribute to significant outcomes to healthcare and society through education, research, and clinical practice. "
      />
      <MembershipTrendsGraph chapters={chapters} aliases={chapterAliases}/>

      <StatsCards stats={stats} />

      <div className="grid gap-6 lg:grid-cols-3">
        {isNationalAdmin && (
          <div className="lg:col-span-2">
            <ChapterListWidget chapters={chapters} />
          </div>
        )}
        <div className={isNationalAdmin ? "" : "lg:col-span-2"}>
          <UpcomingEvents events={upcomingEvents} />
        </div>
      </div>
    </div>
  );
}
