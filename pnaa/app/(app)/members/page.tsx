"use client";

import { MemberList } from "@/components/members/member-list";
import { MemberInsights } from "@/components/members/member-insights";
import { ChurnTrend } from "@/components/members/churn-trend";
import { NewRenewedMembers } from "@/components/members/new-renewed-members";
import { PageHeader } from "@/components/shared/page-header";
import { useScopeLabel } from "@/hooks/use-auth";

export default function MembersPage() {
  const scope = useScopeLabel();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Members"
        description={`Members ${scope}, synced from Wild Apricot`}
      />
      <MemberInsights />
      <ChurnTrend />
      <NewRenewedMembers />
      <MemberList />
    </div>
  );
}
