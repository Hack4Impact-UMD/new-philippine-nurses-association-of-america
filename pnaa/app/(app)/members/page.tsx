"use client";

import { MemberList } from "@/components/members/member-list";
import { MemberInsights } from "@/components/members/member-insights";
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
      <MemberList />
    </div>
  );
}
