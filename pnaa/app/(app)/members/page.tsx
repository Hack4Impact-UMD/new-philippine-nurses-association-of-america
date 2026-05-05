import { MemberList } from "@/components/members/member-list";
import { PageHeader } from "@/components/shared/page-header";

export default function MembersPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Members"
        description="All PNAA members synced from Wild Apricot"
      />
      <MemberList />
    </div>
  );
}
