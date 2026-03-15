"use client";

import { RequireRole } from "@/lib/auth/guards";
import { PageHeader } from "@/components/shared/page-header";
import { UserList } from "@/components/users/user-list";

export default function UsersPage() {
  return (
    <RequireRole roles={["national_admin"]}>
      <div className="space-y-6">
        <PageHeader
          title="User Management"
          description="Manage user accounts and permission levels across PNAA"
        />
        <UserList />
      </div>
    </RequireRole>
  );
}
