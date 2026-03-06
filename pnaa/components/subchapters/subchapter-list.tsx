"use client";

import { useMemo } from "react";
import Link from "next/link";
import { where, orderBy } from "firebase/firestore";
import { useCollection } from "@/hooks/use-firestore";
import { useIsAdmin } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { Plus, Users, ChevronRight } from "lucide-react";
import type { Subchapter } from "@/types/subchapter";

interface SubchapterListProps {
  chapterId: string;
}

export function SubchapterList({ chapterId }: SubchapterListProps) {
  const isAdmin = useIsAdmin();

  const constraints = useMemo(
    () => [
      where("chapterId", "==", chapterId),
      where("archived", "==", false),
      orderBy("name", "asc"),
    ],
    [chapterId]
  );

  const { data: subchapters, loading } = useCollection<Subchapter>(
    "subchapters",
    constraints
  );

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex justify-end">
          <Link href={`/chapters/${chapterId}/subchapters/new`}>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Add Subchapter
            </Button>
          </Link>
        </div>
      )}

      {subchapters.length === 0 ? (
        <EmptyState
          title="No subchapters"
          description="No subchapters have been created for this chapter yet"
        />
      ) : (
        <div className="space-y-3">
          {subchapters.map((subchapter) => (
            <Link
              key={subchapter.id}
              href={`/chapters/${chapterId}/subchapters/${subchapter.id}`}
            >
              <Card className="hover:shadow-md transition-shadow cursor-pointer">
                <CardContent className="pt-4 pb-4 flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="font-medium">{subchapter.name}</p>
                    {subchapter.description && (
                      <p className="text-sm text-muted-foreground mt-0.5 line-clamp-1">
                        {subchapter.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-muted-foreground ml-4 shrink-0">
                    <div className="flex items-center gap-1 text-sm">
                      <Users className="h-4 w-4" />
                      <span>{subchapter.memberIds?.length ?? 0}</span>
                    </div>
                    <ChevronRight className="h-4 w-4" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
