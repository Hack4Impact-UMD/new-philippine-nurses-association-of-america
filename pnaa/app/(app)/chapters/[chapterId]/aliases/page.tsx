"use client";

import { use } from "react";
import Link from "next/link";
import { RequireRole } from "@/lib/auth/guards";
import { ChapterAliases } from "@/components/chapters/chapter-aliases";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function ChapterAliasesPage({
  params,
}: {
  params: Promise<{ chapterId: string }>;
}) {
  const { chapterId } = use(params);

  return (
    <RequireRole roles={["national_admin", "region_admin"]}>
      <div className="space-y-6">
        <Link href={`/chapters/${chapterId}`}>
          <Button variant="ghost" size="sm" className="-ml-2">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Chapter
          </Button>
        </Link>
        <ChapterAliases chapterId={chapterId} />
      </div>
    </RequireRole>
  );
}
