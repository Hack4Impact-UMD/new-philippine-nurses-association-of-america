import { CampaignForm } from "@/components/fundraising/campaign-form";
import { PageHeader } from "@/components/shared/page-header";
import { RequireRole } from "@/lib/auth/guards";

export default function NewCampaignPage() {
  return (
    <RequireRole roles={["national_admin", "chapter_admin"]}>
      <div className="space-y-6 max-w-3xl">
        <PageHeader
          title="Create Campaign"
          description="Add a new fundraising campaign"
        />
        <CampaignForm mode="create" />
      </div>
    </RequireRole>
  );
}
