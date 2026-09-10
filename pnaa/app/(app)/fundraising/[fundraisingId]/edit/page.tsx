"use client";

import { use, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useDocument } from "@/hooks/use-firestore";
import { useCanEditChapter } from "@/hooks/use-auth";
import { CampaignForm } from "@/components/fundraising/campaign-form";
import { PageHeader } from "@/components/shared/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import type { FundraisingCampaign } from "@/types/fundraising";

export default function EditCampaignPage({
  params,
}: {
  params: Promise<{ fundraisingId: string }>;
}) {
  const { fundraisingId } = use(params);
  const router = useRouter();
  const { data: campaign, loading } = useDocument<FundraisingCampaign>(
    "fundraising",
    fundraisingId
  );
  const canEdit = useCanEditChapter(campaign?.chapterId);

  // Read-only roles get bounced back to the campaign detail page.
  const forbidden = !loading && !!campaign && !canEdit;
  useEffect(() => {
    if (forbidden) router.replace(`/fundraising/${fundraisingId}`);
  }, [forbidden, fundraisingId, router]);

  if (loading || forbidden) {
    return (
      <div className="space-y-6 max-w-3xl">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold">Campaign not found</h2>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        title="Edit Campaign"
        description={`Editing: ${campaign.fundraiserName}`}
      />
      <CampaignForm campaign={campaign} mode="edit" />
    </div>
  );
}
