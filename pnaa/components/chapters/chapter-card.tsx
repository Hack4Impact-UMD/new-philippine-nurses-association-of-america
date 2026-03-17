"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Building2, Plus, Users } from "lucide-react";
import type { Chapter } from "@/types/chapter";

export function ChapterCard({
  chapter,
  showAliasButton = false,
}: {
  chapter: Chapter & { id: string };
  showAliasButton?: boolean;
}) {
  return (
    <Link href={`/chapters/${chapter.id}`}>
      <Card className="transition-all hover:shadow-md hover:border-primary/20">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="rounded-md bg-primary/10 p-2 shrink-0">
                <Building2 className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-sm truncate">{chapter.name}</h3>
                <p className="text-xs text-muted-foreground">{chapter.region}</p>
              </div>
            </div>
            {showAliasButton && (
              <Link
                href={`/chapters/${chapter.id}/aliases`}
                onClick={(e) => e.stopPropagation()}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-xs text-muted-foreground hover:text-primary gap-0.5 shrink-0"
                >
                  <Plus className="h-2.5 w-2.5" />
                  alias
                </Button>
              </Link>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-1 text-muted-foreground">
              <Users className="h-3.5 w-3.5" />
              <span>{chapter.totalMembers} members</span>
            </div>
            <div className="flex gap-3 text-xs">
              <span className="text-green-600">{chapter.totalActive} active</span>
              <span className="text-amber-600">{chapter.totalLapsed} lapsed</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
