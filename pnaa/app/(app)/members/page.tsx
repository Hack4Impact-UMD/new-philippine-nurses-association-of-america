"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BarChart3, TrendingDown, UserPlus, Users } from "lucide-react";
import { MemberList } from "@/components/members/member-list";
import { MemberInsights } from "@/components/members/member-insights";
import { ChurnTrend } from "@/components/members/churn-trend";
import { NewRenewedMembers } from "@/components/members/new-renewed-members";
import { useViewScope } from "@/components/members/scope-select";
import { PageHeader } from "@/components/shared/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsAdmin, useScopeLabel } from "@/hooks/use-auth";

// The directory comes first and is the default: most visits are someone
// looking a member up, and stacking the analytics above it pushed the list
// below the fold.
const TABS = [
  { value: "directory", label: "Directory", icon: Users },
  { value: "insights", label: "Insights", icon: BarChart3 },
  { value: "churn", label: "Churn", icon: TrendingDown },
  { value: "new-renewed", label: "New & Renewed", icon: UserPlus },
] as const;

type TabValue = (typeof TABS)[number]["value"];

function isTab(value: string | null): value is TabValue {
  return TABS.some((t) => t.value === value);
}

const hiddenWhenInactive = "data-[state=inactive]:hidden";

export default function MembersPage() {
  const scopeLabel = useScopeLabel();
  const isAdmin = useIsAdmin();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // One scope for both retention tools, so a chapter picked on Churn is still
  // picked on New & Renewed.
  const retentionScope = useViewScope();

  // The tab lives in the URL, so a shared link or a refresh lands on the same
  // view. Anyone who isn't an admin only ever gets the directory.
  const requested = searchParams.get("tab");
  const tab: TabValue = isAdmin && isTab(requested) ? requested : "directory";

  // Analytics tabs mount the first time they're opened and then stay mounted.
  // Nothing fetches for someone who only came for the list, and switching back
  // keeps the chart window, month and search where they were left.
  const [opened, setOpened] = useState<TabValue[]>(["directory"]);
  if (!opened.includes(tab)) setOpened([...opened, tab]);
  const show = (value: TabValue) => isAdmin && opened.includes(value);

  const onTabChange = (value: string) => {
    if (!isTab(value)) return;
    const params = new URLSearchParams(searchParams.toString());
    if (value === "directory") params.delete("tab");
    else params.set("tab", value);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Members"
        description={`Members ${scopeLabel}, synced from Wild Apricot`}
      />

      <Tabs value={tab} onValueChange={onTabChange} className="gap-4">
        {/* Plain members have a single view, so there is nothing to switch
            between. Rendered conditionally in place, never by swapping the
            tree, so the directory doesn't remount when auth resolves. */}
        {isAdmin && (
          // Scrolls sideways instead of wrapping if the labels outgrow a phone.
          <div className="-mx-1 overflow-x-auto px-1 pb-1">
            <TabsList aria-label="Member views">
              {TABS.map(({ value, label, icon: Icon }) => (
                <TabsTrigger key={value} value={value} className="px-3">
                  <Icon className="hidden sm:block" />
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        )}

        {/* Always mounted, so the directory's filters, search and page survive
            a trip to the analytics and back. */}
        <TabsContent value="directory" forceMount className={hiddenWhenInactive}>
          <MemberList />
        </TabsContent>

        {show("insights") && (
          <TabsContent value="insights" forceMount className={hiddenWhenInactive}>
            <MemberInsights />
          </TabsContent>
        )}
        {show("churn") && (
          <TabsContent value="churn" forceMount className={hiddenWhenInactive}>
            <ChurnTrend scope={retentionScope} />
          </TabsContent>
        )}
        {show("new-renewed") && (
          <TabsContent value="new-renewed" forceMount className={hiddenWhenInactive}>
            <NewRenewedMembers scope={retentionScope} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
