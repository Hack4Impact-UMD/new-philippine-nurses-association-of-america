"use client";

import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ArrowUpRight } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { useChaptersMap } from "@/hooks/use-chapters-map";
import type { FundraisingCampaign } from "@/types/fundraising";

export function FundraisingProgress({
  campaigns,
}: {
  campaigns: (FundraisingCampaign & { id: string })[];
}) {
  const { nameFor } = useChaptersMap();
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Active Fundraising</CardTitle>
        <Link
          href="/fundraising"
          className="text-sm text-primary flex items-center gap-1 hover:underline"
        >
          View all <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </CardHeader>
      <CardContent>
        {campaigns.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No active campaigns
          </p>
        ) : (
          <div className="space-y-4">
            {campaigns.map((campaign) => (
              <Link
                key={campaign.id}
                href={`/fundraising/${campaign.id}`}
                className="block rounded-lg p-2 -mx-2 transition-colors hover:bg-accent"
              >
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-medium truncate">
                    {campaign.fundraiserName}
                  </p>
                  <span className="text-sm font-semibold text-primary">
                    {formatCurrency(campaign.amount)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mb-2">
                  {nameFor(campaign.chapterId)}
                </p>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
