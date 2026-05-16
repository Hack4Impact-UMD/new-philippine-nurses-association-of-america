"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DollarSign } from "lucide-react";
import { formatDate, formatCurrency } from "@/lib/utils";
import { useChaptersMap } from "@/hooks/use-chapters-map";
import type { FundraisingCampaign } from "@/types/fundraising";

export function CampaignCard({
  campaign,
}: {
  campaign: FundraisingCampaign & { id: string };
}) {
  const { nameFor } = useChaptersMap();
  return (
    <Link href={`/fundraising/${campaign.id}`}>
      <Card className="transition-all hover:shadow-md hover:border-primary/20">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between">
            <h3 className="font-semibold text-sm line-clamp-2">
              {campaign.fundraiserName}
            </h3>
            <div className="rounded-md bg-secondary/20 p-1.5">
              <DollarSign className="h-4 w-4 text-secondary-foreground" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-2xl font-bold text-primary">
            {formatCurrency(campaign.amount)}
          </p>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{nameFor(campaign.chapterId)}</span>
            <span>{formatDate(campaign.date)}</span>
          </div>
          {campaign.note && (
            <p className="text-xs text-muted-foreground line-clamp-2">
              {campaign.note}
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
