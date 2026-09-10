"use client";

import { ChapterList } from "@/components/chapters/chapter-list";
import { PageHeader } from "@/components/shared/page-header";
import {
  useIsNationalAdmin,
  useIsRegionAdmin,
  useUserRegion,
} from "@/hooks/use-auth";

export default function ChaptersPage() {
  const isNationalAdmin = useIsNationalAdmin();
  const isRegionAdmin = useIsRegionAdmin();
  const region = useUserRegion();

  // Region admins see their region; chapter admins and members see only their
  // own chapter, so the old "All PNAA chapters" blurb would be misleading.
  const description = isNationalAdmin
    ? "All PNAA chapters across the United States"
    : isRegionAdmin
      ? `Chapters in ${region || "your region"}`
      : "Your chapter";

  return (
    <div className="space-y-6">
      <PageHeader title="Chapters" description={description} />
      <ChapterList />
    </div>
  );
}
