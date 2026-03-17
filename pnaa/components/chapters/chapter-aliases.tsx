"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useCollection, useDocument } from "@/hooks/use-firestore";
import { useAuth } from "@/hooks/use-auth";
import { orderBy, where } from "firebase/firestore";
import { deleteDoc, doc } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { addDocument } from "@/lib/firebase/firestore";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Building2, GitMerge, Plus, Trash2 } from "lucide-react";
import type { Chapter } from "@/types/chapter";
import type { ChapterAlias } from "@/types/chapter-alias";

type AliasRow = ChapterAlias & { id: string };
type ChapterRow = Chapter & { id: string };

interface ChapterAliasesProps {
  chapterId: string;
}

export function ChapterAliases({ chapterId }: ChapterAliasesProps) {
  const { user } = useAuth();

  const [addOpen, setAddOpen] = useState(false);
  const [selectedChapterName, setSelectedChapterName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const { data: chapter, loading: chapterLoading } = useDocument<Chapter>(
    "chapters",
    chapterId
  );

  const aliasConstraints = useMemo(
    () => [where("chapterId", "==", chapterId)],
    [chapterId]
  );
  const { data: rawAliases, loading: aliasesLoading } =
    useCollection<ChapterAlias>("chapter_aliases", aliasConstraints);

  // Sort client-side to avoid needing a composite index
  const aliases = useMemo(
    () =>
      [...(rawAliases as AliasRow[])].sort((a, b) =>
        a.aliasName.localeCompare(b.aliasName)
      ),
    [rawAliases]
  );

  const { data: allChapters, loading: chaptersLoading } =
    useCollection<Chapter>("chapters", [orderBy("name", "asc")]);

  const aliasedNames = useMemo(
    () => new Set((aliases as AliasRow[]).map((a) => a.aliasName)),
    [aliases]
  );

  // Chapters available to add as an alias: exclude current chapter and already-added aliases
  const availableChapters = useMemo(() => {
    if (!chapter) return [];
    return (allChapters as ChapterRow[]).filter(
      (c) => c.name !== chapter.name && !aliasedNames.has(c.name)
    );
  }, [allChapters, chapter, aliasedNames]);

  const handleAdd = async () => {
    if (!selectedChapterName || !chapter) return;
    setIsSubmitting(true);
    try {
      await addDocument("chapter_aliases", {
        chapterId,
        aliasName: selectedChapterName,
        createdBy: user?.email || "",
      });
      toast.success(`"${selectedChapterName}" added as an alias`);
      setAddOpen(false);
      setSelectedChapterName("");
    } catch {
      toast.error("Failed to add alias");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (aliasId: string, aliasName: string) => {
    setIsDeleting(true);
    try {
      await deleteDoc(doc(db, "chapter_aliases", aliasId));
      toast.success(`Alias "${aliasName}" removed`);
      setConfirmDeleteId(null);
    } catch {
      toast.error("Failed to remove alias");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleAddOpenChange = (open: boolean) => {
    setAddOpen(open);
    if (!open) setSelectedChapterName("");
  };

  if (chapterLoading || aliasesLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-6 w-full max-w-lg" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!chapter) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Chapter not found.</p>
        <Link
          href="/chapters"
          className="text-primary hover:underline mt-2 inline-block"
        >
          Back to chapters
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-3">
            <GitMerge className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Chapter Aliases</h1>
            <p className="text-muted-foreground text-sm">
              Managing aliases for{" "}
              <Link
                href={`/chapters/${chapterId}`}
                className="font-medium text-foreground hover:underline"
              >
                {chapter.name}
              </Link>
            </p>
          </div>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Alias
        </Button>
      </div>

      {/* Info Banner */}
      <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground leading-relaxed">
        Aliased chapters are hidden from the chapter list. Their members, events,
        and fundraising will appear under{" "}
        <span className="font-medium text-foreground">{chapter.name}</span>.
      </div>

      {/* Aliases List */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            Aliases
            {aliases.length > 0 && (
              <Badge variant="secondary" className="font-normal">
                {aliases.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {aliases.length === 0 ? (
            <EmptyState
              icon={GitMerge}
              title="No aliases yet"
              description="Add an alias to merge another chapter's data into this one"
            />
          ) : (
            <div className="divide-y">
              {(aliases as AliasRow[]).map((alias) => (
                <div
                  key={alias.id}
                  className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
                >
                  <div className="flex items-center gap-3">
                    <div className="rounded-md bg-muted p-1.5 shrink-0">
                      <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{alias.aliasName}</p>
                      <p className="text-xs text-muted-foreground">
                        Added by {alias.createdBy}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {confirmDeleteId === alias.id ? (
                      <>
                        <span className="text-xs text-muted-foreground">
                          Remove alias?
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => setConfirmDeleteId(null)}
                          disabled={isDeleting}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          disabled={isDeleting}
                          onClick={() =>
                            handleDelete(alias.id, alias.aliasName)
                          }
                        >
                          {isDeleting ? "Removing…" : "Remove"}
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => setConfirmDeleteId(alias.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Alias Dialog */}
      <Dialog open={addOpen} onOpenChange={handleAddOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Chapter Alias</DialogTitle>
            <DialogDescription>
              Select a chapter to alias under{" "}
              <span className="font-medium text-foreground">{chapter.name}</span>
              . It will be hidden from the chapter list and its members will
              appear here.
            </DialogDescription>
          </DialogHeader>

          <div className="py-2">
            <Select
              value={selectedChapterName}
              onValueChange={setSelectedChapterName}
              disabled={chaptersLoading}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    chaptersLoading ? "Loading chapters…" : "Select a chapter"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {availableChapters.length === 0 ? (
                  <div className="px-2 py-4 text-sm text-center text-muted-foreground">
                    No chapters available to alias
                  </div>
                ) : (
                  availableChapters.map((c) => (
                    <SelectItem key={c.id} value={c.name}>
                      <span>{c.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {c.region}
                      </span>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => handleAddOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAdd}
              disabled={!selectedChapterName || isSubmitting}
            >
              {isSubmitting ? "Adding…" : "Add Alias"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
