"use client";

import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ArrowUpRight, HandCoins } from "lucide-react";
import { formatCurrency, formatDate, stripChapterPrefix } from "@/lib/utils";
import { useChaptersMap } from "@/hooks/use-chapters-map";
import type { FundraisingCampaign } from "@/types/fundraising";

export function RecentFundraising({
  campaigns,
}: {
  campaigns: (FundraisingCampaign & { id: string })[];
}) {
  const { nameFor } = useChaptersMap();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Recent Fundraising</CardTitle>
        <Link
          href="/fundraising"
          className="text-sm text-primary flex items-center gap-1 hover:underline"
        >
          View all <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </CardHeader>
      <CardContent>
        {campaigns.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <HandCoins className="h-7 w-7 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">No recent contributions</p>
          </div>
        ) : (
          <div className="space-y-1">
            {campaigns.map((campaign) => {
              const chapterName =
                campaign.chapterId && campaign.chapterId !== "national"
                  ? stripChapterPrefix(nameFor(campaign.chapterId))
                  : "National";
              return (
                <Link
                  key={campaign.id}
                  href={`/fundraising/${campaign.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg p-2 -mx-2 transition-colors hover:bg-accent"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {campaign.fundraiserName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {chapterName}
                      {chapterName &&
                        campaign.date &&
                        ` · ${formatDate(campaign.date)}`}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums shrink-0">
                    {formatCurrency(campaign.amount)}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
