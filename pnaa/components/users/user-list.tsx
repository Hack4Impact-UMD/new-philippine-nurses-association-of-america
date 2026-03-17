"use client";

import { useState, useMemo } from "react";
import { useCollection } from "@/hooks/use-firestore";
import {
  AdvancedDataTable,
  type ColumnDef,
} from "@/components/shared/advanced-data-table";
import { SearchInput } from "@/components/shared/search-input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import type { AppUser, UserRole } from "@/types/user";
import type { Chapter } from "@/types/chapter";
import { Users, Pencil } from "lucide-react";

const ROLE_LABELS: Record<UserRole, string> = {
  national_admin: "National Admin",
  region_admin: "Region Admin",
  chapter_admin: "Chapter Admin",
  member: "Member",
};

function RoleBadge({ role }: { role: UserRole }) {
  const variants: Record<UserRole, string> = {
    national_admin:
      "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    region_admin:
      "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
    chapter_admin:
      "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    member: "bg-secondary text-secondary-foreground",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${variants[role]}`}
    >
      {ROLE_LABELS[role]}
    </span>
  );
}

type UserWithId = AppUser & { id: string };

interface EditUserDialogProps {
  user: UserWithId | null;
  chapters: (Chapter & { id: string })[];
  onClose: () => void;
}

function EditUserDialog({ user, chapters, onClose }: EditUserDialogProps) {
  const [role, setRole] = useState<UserRole>(user?.role ?? "member");
  const [chapterName, setChapterName] = useState(user?.chapterName ?? "");
  const [region, setRegion] = useState(user?.region ?? "");
  const [saving, setSaving] = useState(false);

  const regions = useMemo(
    () =>
      [...new Set(chapters.map((c) => c.region).filter(Boolean))].sort() as string[],
    [chapters]
  );

  const filteredChapters = useMemo(
    () =>
      chapters
        .filter((c) => !region || c.region === region)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [chapters, region]
  );

  const handleRoleChange = (newRole: UserRole) => {
    setRole(newRole);
    if (newRole === "national_admin" || newRole === "member") {
      setRegion("");
      setChapterName("");
    }
  };

  const handleChapterChange = (name: string) => {
    setChapterName(name);
    const chapter = chapters.find((c) => c.name === name);
    if (chapter?.region) setRegion(chapter.region);
  };

  const handleSave = async () => {
    if (!user) return;

    if (role === "region_admin" && !region) {
      toast.error("Please select a region for Region Admin");
      return;
    }
    if (role === "chapter_admin" && !chapterName) {
      toast.error("Please select a chapter for Chapter Admin");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role,
          chapterName: role === "chapter_admin" ? chapterName : null,
          region:
            role === "region_admin" || role === "chapter_admin" ? region : null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update user");
      }

      toast.success(`${user.displayName} updated to ${ROLE_LABELS[role]}`);
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update user"
      );
    } finally {
      setSaving(false);
    }
  };

  // Reset state when user changes
  const open = !!user;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Edit Permissions</DialogTitle>
          <DialogDescription>
            Update role and access level for this user.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border bg-muted/30 px-3 py-2.5 mb-2">
          <p className="text-sm font-medium">{user?.displayName}</p>
          <p className="text-xs text-muted-foreground">{user?.email}</p>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="role">Role</Label>
            <Select
              value={role}
              onValueChange={(v) => handleRoleChange(v as UserRole)}
            >
              <SelectTrigger id="role">
                <SelectValue>{ROLE_LABELS[role]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="national_admin">
                  <div className="flex flex-col">
                    <span>National Admin</span>
                    <span className="text-xs text-muted-foreground">
                      Full access to all chapters and data
                    </span>
                  </div>
                </SelectItem>
                <SelectItem value="region_admin">
                  <div className="flex flex-col">
                    <span>Region Admin</span>
                    <span className="text-xs text-muted-foreground">
                      Manage events & fundraising for a region
                    </span>
                  </div>
                </SelectItem>
                <SelectItem value="chapter_admin">
                  <div className="flex flex-col">
                    <span>Chapter Admin</span>
                    <span className="text-xs text-muted-foreground">
                      Manage events & fundraising for a chapter
                    </span>
                  </div>
                </SelectItem>
                <SelectItem value="member">
                  <div className="flex flex-col">
                    <span>Member</span>
                    <span className="text-xs text-muted-foreground">
                      Read-only access
                    </span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {(role === "region_admin" || role === "chapter_admin") && (
            <div className="space-y-1.5">
              <Label htmlFor="region">Region</Label>
              <Select value={region} onValueChange={setRegion}>
                <SelectTrigger id="region">
                  <SelectValue placeholder="Select region..." />
                </SelectTrigger>
                <SelectContent>
                  {regions.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {role === "chapter_admin" && (
            <div className="space-y-1.5">
              <Label htmlFor="chapter">Chapter</Label>
              <Select value={chapterName} onValueChange={handleChapterChange}>
                <SelectTrigger id="chapter">
                  <SelectValue placeholder="Select chapter..." />
                </SelectTrigger>
                <SelectContent>
                  {filteredChapters.map((c) => (
                    <SelectItem key={c.id} value={c.name}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {region && filteredChapters.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No chapters found for this region.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="pt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UserList() {
  const { data: users, loading } = useCollection<AppUser>("users");
  const { data: chapters } = useCollection<Chapter>("chapters");
  const [editing, setEditing] = useState<UserWithId | null>(null);
  const [globalFilter, setGlobalFilter] = useState("");

  const columns = useMemo<ColumnDef<UserWithId, unknown>[]>(
    () => [
      {
        accessorKey: "displayName",
        header: "Name",
        size: 200,
        cell: ({ row }) => (
          <span className="font-medium">{row.original.displayName}</span>
        ),
      },
      {
        accessorKey: "email",
        header: "Email",
        size: 240,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.email}
          </span>
        ),
      },
      {
        accessorKey: "role",
        header: "Role",
        size: 150,
        cell: ({ row }) => <RoleBadge role={row.original.role} />,
        meta: {
          filterType: "select",
          filterOptions: [
            { label: "National Admin", value: "national_admin" },
            { label: "Region Admin", value: "region_admin" },
            { label: "Chapter Admin", value: "chapter_admin" },
            { label: "Member", value: "member" },
          ],
        },
      },
      {
        accessorKey: "region",
        header: "Region",
        size: 160,
        cell: ({ row }) =>
          row.original.region ? (
            <span className="text-sm">{row.original.region}</span>
          ) : (
            <span className="text-muted-foreground/40 text-sm">—</span>
          ),
        meta: { filterType: "text" },
      },
      {
        accessorKey: "chapterName",
        header: "Chapter",
        size: 200,
        cell: ({ row }) =>
          row.original.chapterName ? (
            <span className="text-sm">{row.original.chapterName}</span>
          ) : (
            <span className="text-muted-foreground/40 text-sm">—</span>
          ),
        meta: { filterType: "text" },
      },
      {
        accessorKey: "lastLogin",
        header: "Last Login",
        size: 140,
        cell: ({ row }) => {
          const ts = row.original.lastLogin;
          if (!ts) return <span className="text-muted-foreground/40">—</span>;
          const date =
            typeof ts === "object" && "toDate" in ts
              ? (ts as { toDate: () => Date }).toDate()
              : new Date(ts as unknown as string);
          return (
            <span className="text-sm text-muted-foreground">
              {date.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          );
        },
      },
      {
        id: "actions",
        header: "",
        size: 56,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={(e) => {
              e.stopPropagation();
              setEditing(row.original);
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        ),
      },
    ],
    []
  );

  return (
    <>
      <div className="mb-4">
        <SearchInput
          value={globalFilter}
          onChange={setGlobalFilter}
          placeholder="Search by name, email, chapter..."
          className="max-w-sm"
        />
      </div>

      <AdvancedDataTable
        columns={columns}
        data={users as UserWithId[]}
        loading={loading}
        globalFilter={globalFilter}
        onRowClick={(user) => setEditing(user)}
        emptyTitle="No users found"
        emptyDescription="No users have signed in to the app yet"
        emptyIcon={Users}
        defaultPageSize={25}
        exportFilename="PNAA_users"
      />

      {editing && (
        <EditUserDialog
          user={editing}
          chapters={chapters}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
