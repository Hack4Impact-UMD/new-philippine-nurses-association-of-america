"use client";

import Link from "next/link";
import { useDocument } from "@/hooks/use-firestore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDate, formatCurrency } from "@/lib/utils";
import { Pencil, DollarSign, Calendar, Building2 } from "lucide-react";
import { useIsAdmin } from "@/hooks/use-auth";
import { useChaptersMap } from "@/hooks/use-chapters-map";
import type { FundraisingCampaign } from "@/types/fundraising";

export function CampaignDetail({ campaignId }: { campaignId: string }) {
  const { data: campaign, loading } = useDocument<FundraisingCampaign>(
    "fundraising",
    campaignId
  );
  const isAdmin = useIsAdmin();
  const { nameFor } = useChaptersMap();

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-48 rounded-lg" />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold">Campaign not found</h2>
        <Link
          href="/fundraising"
          className="text-primary hover:underline mt-2 inline-block"
        >
          Back to fundraising
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{campaign.fundraiserName}</h1>
            {campaign.archived && <StatusBadge variant="archived" />}
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Calendar className="h-4 w-4" />
              {formatDate(campaign.date)}
            </span>
            <span className="flex items-center gap-1">
              <Building2 className="h-4 w-4" />
              {nameFor(campaign.chapterId)}
            </span>
          </div>
        </div>
        {isAdmin && (
          <Link href={`/fundraising/${campaignId}/edit`}>
            <Button>
              <Pencil className="mr-2 h-4 w-4" />
              Edit Campaign
            </Button>
          </Link>
        )}
      </div>

      {/* Amount */}
      <Card>
        <CardContent className="pt-6 flex items-center gap-4">
          <div className="rounded-full bg-primary/10 p-4">
            <DollarSign className="h-8 w-8 text-primary" />
          </div>
          <div>
            <p className="text-3xl font-bold text-primary">
              {formatCurrency(campaign.amount)}
            </p>
            <p className="text-sm text-muted-foreground">Amount Raised</p>
          </div>
        </CardContent>
      </Card>

      {/* Note */}
      {campaign.note && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
              {campaign.note}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Metadata */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Last Updated By</span>
            <span>{campaign.lastUpdatedUser || "—"}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
