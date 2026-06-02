"use client";

import Link from "next/link";
import { CampaignList } from "@/components/fundraising/campaign-list";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useIsAdmin } from "@/hooks/use-auth";
import { BulkCampaignUploadButton } from "@/components/fundraising/bulk-campaign-upload";

export default function FundraisingPage() {
  const isAdmin = useIsAdmin();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fundraising"
        description="All fundraising campaigns across PNAA"
      >
        {isAdmin && (
          <div className="flex items-center gap-2">
            <BulkCampaignUploadButton />
            <Button asChild>
              <Link href="/fundraising/new">
                <Plus className="mr-2 h-4 w-4" />
                Add Campaign
              </Link>
            </Button>
          </div>
        )}
      </PageHeader>
      <CampaignList />
    </div>
  );
}
