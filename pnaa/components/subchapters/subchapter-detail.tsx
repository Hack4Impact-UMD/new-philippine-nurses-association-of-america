"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { where, orderBy } from "firebase/firestore";
import { useDocument, useCollection } from "@/hooks/use-firestore";
import { useAuth, useIsAdmin } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { EventCard } from "@/components/events/event-card";
import { updateDocument, archiveDocument } from "@/lib/firebase/firestore";
import { toast } from "sonner";
import { Building2, Users, Plus, X, Search, Pencil, Trash2 } from "lucide-react";
import { formatDate, formatCurrency } from "@/lib/utils";
import type { Subchapter } from "@/types/subchapter";
import type { Member } from "@/types/member";
import type { AppEvent } from "@/types/event";
import type { FundraisingCampaign } from "@/types/fundraising";

interface SubchapterDetailProps {
  chapterId: string;
  subchapterId: string;
}

export function SubchapterDetail({ chapterId, subchapterId }: SubchapterDetailProps) {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = useIsAdmin();

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const { data: subchapter, loading: subchapterLoading } = useDocument<Subchapter>(
    "subchapters",
    subchapterId
  );

  const memberConstraints = useMemo(
    () =>
      subchapter?.chapterName
        ? [
            where("chapterName", "==", subchapter.chapterName),
            orderBy("name", "asc"),
          ]
        : [],
    [subchapter?.chapterName]
  );

  const { data: chapterMembers, loading: membersLoading } = useCollection<Member>(
    "members",
    subchapter?.chapterName ? memberConstraints : []
  );

  const eventConstraints = useMemo(
    () => [
      where("subchapterId", "==", subchapterId),
      where("archived", "==", false),
      orderBy("startDate", "desc"),
    ],
    [subchapterId]
  );

  const fundraisingConstraints = useMemo(
    () => [
      where("subchapterId", "==", subchapterId),
      where("archived", "==", false),
      orderBy("date", "desc"),
    ],
    [subchapterId]
  );

  const { data: events, loading: eventsLoading } = useCollection<AppEvent>(
    "events",
    eventConstraints
  );

  const { data: campaigns, loading: campaignsLoading } =
    useCollection<FundraisingCampaign>("fundraising", fundraisingConstraints);

  const memberIds = subchapter?.memberIds ?? [];

  const currentMembers = useMemo(
    () => chapterMembers.filter((m) => memberIds.includes(m.id)),
    [chapterMembers, memberIds]
  );

  const availableMembers = useMemo(
    () => chapterMembers.filter((m) => !memberIds.includes(m.id)),
    [chapterMembers, memberIds]
  );

  const filteredAvailable = useMemo(() => {
    const q = search.toLowerCase();
    return availableMembers.filter(
      (m) =>
        m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)
    );
  }, [availableMembers, search]);

  const handleRemoveMember = async (memberId: string) => {
    if (!subchapter) return;
    try {
      await updateDocument("subchapters", subchapterId, {
        memberIds: memberIds.filter((id) => id !== memberId),
        lastUpdatedUser: user?.email || "",
      });
      toast.success("Member removed");
    } catch {
      toast.error("Failed to remove member");
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleAddMembers = async () => {
    if (!subchapter || selectedIds.length === 0) return;
    setIsSaving(true);
    try {
      await updateDocument("subchapters", subchapterId, {
        memberIds: [...memberIds, ...selectedIds],
        lastUpdatedUser: user?.email || "",
      });
      const count = selectedIds.length;
      toast.success(`${count} member${count > 1 ? "s" : ""} added`);
      setSelectedIds([]);
      setSearch("");
      setAddDialogOpen(false);
    } catch {
      toast.error("Failed to add members");
    } finally {
      setIsSaving(false);
    }
  };

  const handleArchive = async () => {
    setIsDeleting(true);
    try {
      await archiveDocument("subchapters", subchapterId);
      toast.success("Subchapter deleted");
      router.push(`/chapters/${chapterId}`);
    } catch {
      toast.error("Failed to delete subchapter");
      setIsDeleting(false);
    }
  };

  if (subchapterLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-12 w-12 rounded-lg" />
          <div>
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-32 mt-1" />
          </div>
        </div>
        <Skeleton className="h-20" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!subchapter) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold">Subchapter not found</h2>
        <Link
          href={`/chapters/${chapterId}`}
          className="text-primary hover:underline mt-2 inline-block"
        >
          Back to chapter
        </Link>
      </div>
    );
  }

  const addEventUrl = `/events/new?subchapterId=${subchapterId}&chapter=${encodeURIComponent(subchapter.chapterName)}&region=${encodeURIComponent(subchapter.region)}`;
  const addCampaignUrl = `/fundraising/new?subchapterId=${subchapterId}&chapterName=${encodeURIComponent(subchapter.chapterName)}`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-3">
            <Building2 className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{subchapter.name}</h1>
            <Link
              href={`/chapters/${chapterId}`}
              className="text-sm text-muted-foreground hover:underline"
            >
              {subchapter.chapterName}
            </Link>
          </div>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <Link href={`/chapters/${chapterId}/subchapters/${subchapterId}/edit`}>
              <Button variant="outline" size="sm">
                <Pencil className="h-4 w-4 mr-2" />
                Edit
              </Button>
            </Link>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setDeleteDialogOpen(true)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </Button>
          </div>
        )}
      </div>

      {subchapter.description && (
        <p className="text-muted-foreground">{subchapter.description}</p>
      )}

      {/* Stats */}
      <Card>
        <CardContent className="pt-4 pb-4 flex items-center gap-3">
          <Users className="h-5 w-5 text-primary" />
          <div>
            <p className="text-2xl font-bold">{memberIds.length}</p>
            <p className="text-xs text-muted-foreground">Members</p>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="members">
        <TabsList>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="fundraising">Fundraising</TabsTrigger>
        </TabsList>

        {/* Members Tab */}
        <TabsContent value="members" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base">Members</CardTitle>
              {isAdmin && (
                <Button
                  size="sm"
                  onClick={() => {
                    setSearch("");
                    setSelectedIds([]);
                    setAddDialogOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Members
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {membersLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-12" />
                  ))}
                </div>
              ) : currentMembers.length === 0 ? (
                <EmptyState
                  title="No members"
                  description="Add members to this subchapter using the button above"
                />
              ) : (
                <div className="divide-y">
                  {currentMembers.map((member) => (
                    <div
                      key={member.id}
                      className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
                    >
                      <div>
                        <p className="font-medium text-sm">{member.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {member.email}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge
                          variant={
                            member.activeStatus === "Active" ? "active" : "lapsed"
                          }
                        />
                        {isAdmin && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => handleRemoveMember(member.id)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Events Tab */}
        <TabsContent value="events" className="mt-4">
          {isAdmin && (
            <div className="flex justify-end mb-4">
              <Link href={addEventUrl}>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Event
                </Button>
              </Link>
            </div>
          )}
          {eventsLoading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-48" />
              ))}
            </div>
          ) : events.length === 0 ? (
            <EmptyState
              title="No events"
              description="No events have been created for this subchapter yet"
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {events.map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Fundraising Tab */}
        <TabsContent value="fundraising" className="mt-4">
          {isAdmin && (
            <div className="flex justify-end mb-4">
              <Link href={addCampaignUrl}>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Campaign
                </Button>
              </Link>
            </div>
          )}
          {campaignsLoading ? (
            <Skeleton className="h-48" />
          ) : campaigns.length === 0 ? (
            <EmptyState
              title="No campaigns"
              description="No fundraising campaigns have been created for this subchapter yet"
            />
          ) : (
            <div className="space-y-3">
              {campaigns.map((campaign) => (
                <Link
                  key={campaign.id}
                  href={`/fundraising/${campaign.id}`}
                  className="block"
                >
                  <Card className="hover:shadow-md transition-shadow">
                    <CardContent className="pt-4 pb-4 flex items-center justify-between">
                      <div>
                        <p className="font-medium">{campaign.fundraiserName}</p>
                        <p className="text-sm text-muted-foreground">
                          {formatDate(campaign.date)}
                        </p>
                      </div>
                      <p className="text-lg font-bold text-primary">
                        {formatCurrency(campaign.amount)}
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Add Members Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Members</DialogTitle>
          </DialogHeader>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or email..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="max-h-72 overflow-y-auto divide-y border rounded-md">
            {membersLoading ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                Loading members...
              </div>
            ) : filteredAvailable.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                {search
                  ? "No members match your search"
                  : "All chapter members are already in this subchapter"}
              </div>
            ) : (
              filteredAvailable.map((member) => (
                <label
                  key={member.id}
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={selectedIds.includes(member.id)}
                    onChange={() => toggleSelect(member.id)}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{member.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {member.email}
                    </p>
                  </div>
                  <StatusBadge
                    variant={
                      member.activeStatus === "Active" ? "active" : "lapsed"
                    }
                  />
                </label>
              ))
            )}
          </div>

          {selectedIds.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {selectedIds.length} member{selectedIds.length > 1 ? "s" : ""}{" "}
              selected
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddMembers}
              disabled={selectedIds.length === 0 || isSaving}
            >
              {isSaving
                ? "Adding..."
                : `Add${selectedIds.length > 0 ? ` (${selectedIds.length})` : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Subchapter</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{" "}
              <span className="font-medium text-foreground">
                {subchapter.name}
              </span>
              ? This will remove the subchapter and its member assignments.
              Events and fundraising campaigns linked to this subchapter will
              remain in the global lists.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleArchive}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete Subchapter"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
