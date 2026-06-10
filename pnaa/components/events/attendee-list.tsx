"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  collection,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentSnapshot,
  type QueryConstraint,
} from "@/lib/supabase/firestore";
import {
  AdvancedDataTable,
  type ColumnDef,
  type ColumnMeta,
} from "@/components/shared/advanced-data-table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SearchInput } from "@/components/shared/search-input";
import { Users, UserPlus, Trash2, ChevronLeft, ChevronRight, Upload } from "lucide-react";
import { BulkAttendanceUpload } from "@/components/events/bulk-attendance-upload";
import { BulkAttendanceCsvDialog } from "@/components/events/bulk-attendance-csv";
import { toast } from "sonner";
import { useAuth, useIsAdmin, useIsNationalAdmin } from "@/hooks/use-auth";
import { useChaptersMap } from "@/hooks/use-chapters-map";
import { useSubevents } from "@/hooks/use-subevents";
import { useDebounce } from "@/hooks/use-debounce";
import { isNationalConference } from "@/lib/national-conference";
import {
  setAttendance,
  setAttendeeHours,
  setSubeventAttendance,
  addManualAttendee,
  removeManualAttendee,
  manualAttendeeId,
} from "@/lib/supabase/attendees";
import type { Attendee } from "@/types/attendee";
import type { AppEvent } from "@/types/event";
import type { Member } from "@/types/member";

type AttendeeRow = Attendee & { id: string };

const WA_PAGE_SIZE = 50;

/** Escape LIKE/ILIKE wildcards in user input so a literal "%" doesn't match everything. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export function AttendeeList({ event }: { event: AppEvent & { id: string } }) {
  const { user } = useAuth();
  const isAdmin = useIsAdmin();
  const isNationalAdmin = useIsNationalAdmin();
  const { nameFor: subeventNameFor } = useSubevents();
  const isNational = isNationalConference(event);
  const eventSubeventIds = useMemo(
    () => event.subeventIds ?? [],
    [event.subeventIds]
  );
  const [addOpen, setAddOpen] = useState(false);
  const [bulkUploadOpen, setBulkUploadOpen] = useState(false);

  // ─── WA registrations: paginated server-side ───────────────────────────
  const [waRows, setWaRows] = useState<AttendeeRow[]>([]);
  const [waLoading, setWaLoading] = useState(true);
  const [waPage, setWaPage] = useState(0);
  // cursors[i] is the startAfter cursor used to fetch page i. cursors[0] is null.
  const [waCursors, setWaCursors] = useState<(DocumentSnapshot | null)[]>([null]);
  const [waHasMore, setWaHasMore] = useState(false);
  const [waSearch, setWaSearch] = useState("");
  const debouncedWaSearch = useDebounce(waSearch, 300);

  // Reset pagination when the search changes.
  useEffect(() => {
    setWaPage(0);
    setWaCursors([null]);
  }, [debouncedWaSearch]);

  useEffect(() => {
    let cancelled = false;
    setWaLoading(true);

    const startCursor = waCursors[waPage] ?? null;
    const constraints: QueryConstraint[] = [
      where("eventId", "==", event.id),
      where("source", "==", "wildapricot"),
    ];
    if (debouncedWaSearch.trim().length > 0) {
      constraints.push(where("name", "ilike", `%${escapeLike(debouncedWaSearch.trim())}%`));
    }
    constraints.push(orderBy("name"));
    if (startCursor) constraints.push(startAfter(startCursor));
    constraints.push(fsLimit(WA_PAGE_SIZE + 1)); // +1 to detect more

    getDocs(query(collection("events", event.id, "attendees"), ...constraints))
      .then((snap) => {
        if (cancelled) return;
        const docs = snap.docs;
        const hasMore = docs.length > WA_PAGE_SIZE;
        const pageDocs = hasMore ? docs.slice(0, WA_PAGE_SIZE) : docs;
        setWaRows(
          pageDocs.map((d) => ({ ...(d.data() as Attendee), id: d.id }))
        );
        setWaHasMore(hasMore);
        // Stash next-page cursor if we don't have it yet.
        if (hasMore) {
          const nextCursor = pageDocs[pageDocs.length - 1];
          setWaCursors((prev) => {
            if (prev[waPage + 1] === nextCursor) return prev;
            const next = [...prev];
            next[waPage + 1] = nextCursor;
            return next;
          });
        }
      })
      .catch((err) => {
        if (!cancelled) console.error("Failed to load WA attendees", err);
      })
      .finally(() => {
        if (!cancelled) setWaLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id, waPage, debouncedWaSearch]);

  // ─── Manual attendees: small set, one-shot ─────────────────────────────
  const [manualRows, setManualRows] = useState<AttendeeRow[]>([]);
  const [manualLoading, setManualLoading] = useState(true);

  const loadManual = useCallback(async () => {
    setManualLoading(true);
    try {
      const snap = await getDocs(
        query(
          collection("events", event.id, "attendees"),
          where("eventId", "==", event.id),
          where("source", "==", "app"),
          orderBy("name")
        )
      );
      setManualRows(
        snap.docs.map((d) => ({ ...(d.data() as Attendee), id: d.id }))
      );
    } finally {
      setManualLoading(false);
    }
  }, [event.id]);

  useEffect(() => {
    loadManual();
  }, [loadManual]);

  // Optimistic local-state mutators — avoid extra reads after admin actions.
  const patchWaRow = (id: string, patch: Partial<AttendeeRow>) =>
    setWaRows((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const patchManualRow = (id: string, patch: Partial<AttendeeRow>) =>
    setManualRows((rows) =>
      rows.map((r) => (r.id === id ? { ...r, ...patch } : r))
    );

  // The `row` a cell handler closes over can be stale after rapid successive
  // edits — capture rollback state from the latest rows instead.
  const waRowsRef = useRef(waRows);
  waRowsRef.current = waRows;
  const manualRowsRef = useRef(manualRows);
  manualRowsRef.current = manualRows;
  const currentRow = (row: AttendeeRow): AttendeeRow =>
    (row.source === "app" ? manualRowsRef : waRowsRef).current.find(
      (r) => r.id === row.id
    ) ?? row;

  const computeNextHours = (row: AttendeeRow, attended: boolean): number => {
    if (!attended) return 0;
    if (event.eventType === "conference") return event.defaultHours ?? 0;
    return (row.hours ?? 0) > 0 ? row.hours : event.defaultHours ?? 0;
  };

  const handleToggleAttended = async (
    row: AttendeeRow,
    attended: boolean
  ) => {
    const prev = currentRow(row);
    const newHours = computeNextHours(prev, attended);
    const patch = { attended, hours: newHours };
    if (row.source === "app") patchManualRow(row.id, patch);
    else patchWaRow(row.id, patch);
    try {
      await setAttendance({
        eventId: event.id,
        attendee: prev,
        attended,
        eventType: event.eventType,
        eventDefaultHours: event.defaultHours ?? 0,
        user: user?.email || "",
      });
    } catch (err) {
      console.error(err);
      toast.error("Failed to update attendance");
      // Roll back optimistic update.
      const rollback = { attended: prev.attended, hours: prev.hours };
      if (row.source === "app") patchManualRow(row.id, rollback);
      else patchWaRow(row.id, rollback);
    }
  };

  const handleToggleSubevent = async (
    row: AttendeeRow,
    subeventId: string,
    attended: boolean
  ) => {
    const prev = currentRow(row);
    const oldArr = prev.attendedSubeventIds ?? [];
    const nextArr = attended
      ? oldArr.includes(subeventId)
        ? oldArr
        : [...oldArr, subeventId]
      : oldArr.filter((id) => id !== subeventId);
    const nextHours = nextArr.length * (event.defaultHours ?? 0);
    const patch = {
      attendedSubeventIds: nextArr,
      hours: nextHours,
      attended: nextArr.length > 0,
    };
    if (row.source === "app") patchManualRow(row.id, patch);
    else patchWaRow(row.id, patch);
    try {
      await setSubeventAttendance({
        eventId: event.id,
        attendeeId: row.id,
        subeventId,
        attended,
        user: user?.email || "",
      });
    } catch (err) {
      console.error(err);
      toast.error("Failed to update sub-event attendance");
      const rollback = {
        attendedSubeventIds: oldArr,
        hours: prev.hours,
        attended: prev.attended,
      };
      if (row.source === "app") patchManualRow(row.id, rollback);
      else patchWaRow(row.id, rollback);
    }
  };

  const handleHoursChange = async (row: AttendeeRow, newHours: number) => {
    const prev = currentRow(row);
    const patch = { hours: newHours };
    if (row.source === "app") patchManualRow(row.id, patch);
    else patchWaRow(row.id, patch);
    try {
      await setAttendeeHours({
        eventId: event.id,
        attendee: prev,
        newHours,
        user: user?.email || "",
      });
    } catch (err) {
      console.error(err);
      toast.error("Failed to update hours");
      const rollback = { hours: prev.hours };
      if (row.source === "app") patchManualRow(row.id, rollback);
      else patchWaRow(row.id, rollback);
    }
  };

  // Remove flow: the trash button stages the row; the dialog below confirms.
  const [removeTarget, setRemoveTarget] = useState<AttendeeRow | null>(null);

  const handleRemoveManual = async (row: AttendeeRow) => {
    setRemoveTarget(null);
    setManualRows((rows) => rows.filter((r) => r.id !== row.id));
    try {
      await removeManualAttendee({
        eventId: event.id,
        attendee: row,
        user: user?.email || "",
      });
      toast.success("Attendee removed");
    } catch (err) {
      console.error(err);
      toast.error("Failed to remove attendee");
      // Re-fetch manual rows to recover state.
      await loadManual();
    }
  };

  // Columns shared between WA and manual sections.
  const attendanceColumn: ColumnDef<AttendeeRow, unknown> = useMemo(
    () => ({
      id: "attended",
      header: "Attended",
      size: 100,
      enableSorting: true,
      accessorFn: (row) => (row.attended ? 1 : 0),
      cell: ({ row }) =>
        isAdmin ? (
          <Switch
            checked={row.original.attended}
            onCheckedChange={(v) => handleToggleAttended(row.original, v)}
            aria-label="Mark attended"
          />
        ) : row.original.attended ? (
          <Badge
            variant="outline"
            className="text-xs text-green-700 border-green-200 bg-green-50 dark:bg-green-950/30"
          >
            Yes
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    }),
    [isAdmin, event.eventType, event.defaultHours, user?.email]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  );

  const hoursColumn: ColumnDef<AttendeeRow, unknown> = useMemo(
    () => ({
      id: "hours",
      header: "Hours",
      size: 110,
      enableSorting: true,
      accessorFn: (row) => row.hours ?? 0,
      cell: ({ row }) => {
        const r = row.original;
        if (event.eventType === "conference") {
          return (
            <span className="tabular-nums text-sm">
              {r.attended ? r.hours : "—"}
            </span>
          );
        }
        if (!r.attended) {
          return <span className="text-sm text-muted-foreground">—</span>;
        }
        if (!isAdmin) {
          return <span className="tabular-nums text-sm">{r.hours}</span>;
        }
        return (
          <Input
            type="number"
            min={0}
            step="0.5"
            defaultValue={r.hours}
            className="h-8 w-20 text-sm"
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v !== r.hours) {
                handleHoursChange(r, v);
              }
            }}
          />
        );
      },
    }),
    [isAdmin, event.eventType, user?.email]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  );

  const subeventColumns: ColumnDef<AttendeeRow, unknown>[] = useMemo(
    () =>
      eventSubeventIds.map((subeventId) => ({
        id: `subevent:${subeventId}`,
        header: subeventNameFor(subeventId, "Sub-event"),
        size: 110,
        enableSorting: false,
        accessorFn: (row: AttendeeRow) =>
          (row.attendedSubeventIds ?? []).includes(subeventId) ? 1 : 0,
        cell: ({ row }: { row: { original: AttendeeRow } }) => {
          const checked = (row.original.attendedSubeventIds ?? []).includes(
            subeventId
          );
          return isAdmin ? (
            <Checkbox
              checked={checked}
              onCheckedChange={(v) =>
                handleToggleSubevent(row.original, subeventId, Boolean(v))
              }
              aria-label={`Toggle ${subeventNameFor(subeventId)}`}
            />
          ) : checked ? (
            <Badge
              variant="outline"
              className="text-xs text-green-700 border-green-200 bg-green-50 dark:bg-green-950/30"
            >
              Yes
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          );
        },
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eventSubeventIds, isAdmin, subeventNameFor, event.defaultHours]
  );

  const totalHoursColumn: ColumnDef<AttendeeRow, unknown> = useMemo(
    () => ({
      id: "totalHours",
      header: "Total Hours",
      size: 110,
      enableSorting: true,
      accessorFn: (row) =>
        (row.attendedSubeventIds ?? []).length * (event.defaultHours ?? 0),
      cell: ({ row }) => {
        const count = (row.original.attendedSubeventIds ?? []).length;
        const total = count * (event.defaultHours ?? 0);
        return count === 0 ? (
          <span className="text-sm text-muted-foreground">—</span>
        ) : (
          <span className="tabular-nums text-sm">
            {total}
            <span className="ml-1 text-xs text-muted-foreground">
              ({count}×{event.defaultHours ?? 0})
            </span>
          </span>
        );
      },
    }),
    [event.defaultHours]
  );

  const waColumns: ColumnDef<AttendeeRow, unknown>[] = useMemo(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        size: 200,
        enableSorting: true,
        cell: ({ row }) => (
          <a
            href={`https://mypnaa.org/admin/contacts/details/?contactId=${row.original.contactId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-sm text-primary hover:underline"
          >
            {row.original.name || "—"}
          </a>
        ),
      },
      {
        accessorKey: "registrationType",
        header: "Registration Type",
        size: 90,
        enableSorting: true,
        cell: ({ row }) => (
          <span className="tabular-nums text-sm">
            {row.original.registrationType || "—"}
          </span>
        ),
      },
      {
        accessorKey: "Status",
        header: "Payment",
        size: 100,
        enableSorting: true,
        filterFn: (row, _columnId, filterValue) => {
          if (filterValue === "true") return row.original.isPaid;
          if (filterValue === "false") return !row.original.isPaid;
          return true;
        },
        meta: {
          filterType: "select",
          filterOptions: [
            { label: "Yes", value: "true" },
            { label: "No", value: "false" },
          ],
        } satisfies ColumnMeta,
        accessorFn: (row) => {
          if (row.registrationFee === 0) return 1_000_000;
          if (row.isPaid) return -row.paidSum;
          return 2_000_000;
        },
        cell: ({ row }) =>
          row.original.registrationFee === 0 ? (
            <Badge
              variant="outline"
              className="text-xs text-muted-foreground border-muted bg-muted/50"
            >
              Free
            </Badge>
          ) : row.original.isPaid ? (
            <Badge
              variant="outline"
              className="text-xs text-green-700 border-green-200 bg-green-50 dark:bg-green-950/30"
            >
              {isNationalAdmin
                ? `Paid in Full - $${row.original.paidSum.toFixed(2)}`
                : "Paid in Full"}
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="text-xs text-amber-700 border-amber-200 bg-amber-50 dark:bg-amber-950/30"
            >
              {isNationalAdmin
                ? `$${(row.original.registrationFee - row.original.paidSum).toFixed(2)} Due`
                : "Unpaid"}
            </Badge>
          ),
      },
      ...(isNational
        ? [...subeventColumns, totalHoursColumn]
        : [attendanceColumn, hoursColumn]),
    ],
    [isNationalAdmin, isNational, subeventColumns, totalHoursColumn, attendanceColumn, hoursColumn]
  );

  const manualColumns: ColumnDef<AttendeeRow, unknown>[] = useMemo(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        size: 220,
        enableSorting: true,
        meta: { filterType: "text" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="font-medium text-sm">
            {row.original.name || "—"}
          </span>
        ),
      },
      ...(isNational
        ? [...subeventColumns, totalHoursColumn]
        : [attendanceColumn, hoursColumn]),
      ...(isAdmin
        ? [
            {
              id: "actions",
              header: "",
              size: 60,
              enableSorting: false,
              cell: ({ row }: { row: { original: AttendeeRow } }) => (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    setRemoveTarget(row.original);
                  }}
                  aria-label="Remove attendee"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              ),
            } as ColumnDef<AttendeeRow, unknown>,
          ]
        : []),
    ],
    [isAdmin, isNational, subeventColumns, totalHoursColumn, attendanceColumn, hoursColumn]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  );

  const totalRegistered = event.registrations ?? event.attendees ?? 0;
  const existingMemberIds = useMemo(
    () => new Set([...waRows, ...manualRows].map((r) => r.memberId).filter(Boolean)),
    [waRows, manualRows]
  );

  const onManualAdded = (newRow: AttendeeRow) => {
    setManualRows((rows) =>
      [...rows, newRow].sort((a, b) => a.name.localeCompare(b.name))
    );
  };

  // Force the manual list to refetch after a bulk upload (new attendees may
  // have been added during conflict resolution).
  const refetchAfterBulk = () => {
    loadManual();
    // The WA table refetches when its effect deps change; bump search to force.
    setWaPage((p) => p);
  };

  return (
    <div className="space-y-6">
      {isNational && isAdmin && (
        <section className="rounded-md border bg-muted/30 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-semibold">Bulk Sub-Event Attendance</p>
            <p className="text-xs text-muted-foreground">
              Upload a CSV (Name, Sub-Event, Attended) to mark many people at once.
            </p>
          </div>
          <Button size="sm" onClick={() => setBulkUploadOpen(true)}>
            <Upload className="h-4 w-4 mr-1.5" />
            Bulk Upload Attendance
          </Button>
        </section>
      )}

      {!isNational && isAdmin && (
        <section className="rounded-md border bg-muted/30 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-semibold">Bulk Attendance</p>
            <p className="text-xs text-muted-foreground">
              Upload a CSV (Name, Email, Attended, Hours) to mark many people at once.
            </p>
          </div>
          <Button size="sm" onClick={() => setBulkUploadOpen(true)}>
            <Upload className="h-4 w-4 mr-1.5" />
            Bulk Upload Attendance
          </Button>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-sm font-semibold">
            Wild Apricot Registrations
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {totalRegistered.toLocaleString()} total
            </span>
          </h3>
          <SearchInput
            value={waSearch}
            onChange={setWaSearch}
            placeholder="Search by name..."
            className="w-full sm:max-w-xs"
          />
        </div>
        <AdvancedDataTable<AttendeeRow>
          columns={waColumns}
          data={waRows}
          loading={waLoading}
          emptyTitle={
            debouncedWaSearch.trim().length > 0
              ? "No matching registrations"
              : "No registrations"
          }
          emptyDescription={
            debouncedWaSearch.trim().length > 0
              ? "Try a different search term"
              : "No Wild Apricot registrations for this event"
          }
          emptyIcon={Users}
          defaultPageSize={WA_PAGE_SIZE}
          exportFilename={`PNAA_${event.id}_registrations`}
        />
        <WaPaginator
          page={waPage}
          hasMore={waHasMore}
          loading={waLoading}
          rowCount={waRows.length}
          onPrev={() => setWaPage((p) => Math.max(0, p - 1))}
          onNext={() => setWaPage((p) => p + 1)}
        />
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            Manually Added Attendees
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {manualRows.length}
            </span>
          </h3>
          {isAdmin && (
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <UserPlus className="h-4 w-4 mr-1.5" />
              Add Attendee
            </Button>
          )}
        </div>
        <AdvancedDataTable<AttendeeRow>
          columns={manualColumns}
          data={manualRows}
          loading={manualLoading}
          emptyTitle="No manual attendees"
          emptyDescription={
            isAdmin
              ? "Click 'Add Attendee' to record a member who attended"
              : "No additional attendees recorded"
          }
          emptyIcon={UserPlus}
          defaultPageSize={15}
          exportFilename={`PNAA_${event.id}_manual_attendees`}
        />
      </section>

      {isAdmin && (
        <AddManualAttendeeDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          event={event}
          existingMemberIds={existingMemberIds}
          onAdded={onManualAdded}
        />
      )}

      <Dialog
        open={!!removeTarget}
        onOpenChange={(v) => {
          if (!v) setRemoveTarget(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove attendee</DialogTitle>
            <DialogDescription>
              Remove {removeTarget?.name} from this event? Their recorded
              attendance and hours will be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => removeTarget && handleRemoveManual(removeTarget)}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isNational && isAdmin && (
        <BulkAttendanceUpload
          open={bulkUploadOpen}
          onOpenChange={setBulkUploadOpen}
          event={event}
          onApplied={refetchAfterBulk}
        />
      )}

      {!isNational && isAdmin && (
        <BulkAttendanceCsvDialog
          open={bulkUploadOpen}
          onOpenChange={setBulkUploadOpen}
          event={event}
          onApplied={refetchAfterBulk}
        />
      )}
    </div>
  );
}

function WaPaginator({
  page,
  hasMore,
  loading,
  rowCount,
  onPrev,
  onNext,
}: {
  page: number;
  hasMore: boolean;
  loading: boolean;
  rowCount: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  if (rowCount === 0 && page === 0) return null;
  return (
    <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
      <span className="tabular-nums">Page {page + 1}</span>
      <Button
        variant="outline"
        size="sm"
        className="h-7 px-2"
        onClick={onPrev}
        disabled={page === 0 || loading}
        aria-label="Previous page"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-7 px-2"
        onClick={onNext}
        disabled={!hasMore || loading}
        aria-label="Next page"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

// Outer dialog defers all heavy work to the body component, which only mounts
// while `open` is true. This avoids the member-search hook running on every
// event-detail page load.
function AddManualAttendeeDialog({
  open,
  onOpenChange,
  event,
  existingMemberIds,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  event: AppEvent & { id: string };
  existingMemberIds: Set<string>;
  onAdded: (row: AttendeeRow) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        {open && (
          <AddManualAttendeeDialogBody
            event={event}
            existingMemberIds={existingMemberIds}
            onAdded={onAdded}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AddManualAttendeeDialogBody({
  event,
  existingMemberIds,
  onAdded,
  onClose,
}: {
  event: AppEvent & { id: string };
  existingMemberIds: Set<string>;
  onAdded: (row: AttendeeRow) => void;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const { nameFor } = useChaptersMap();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 250);
  const [scopeChapter, setScopeChapter] = useState<boolean>(
    Boolean(event.chapterId)
  );
  const [results, setResults] = useState<(Member & { id: string })[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<(Member & { id: string }) | null>(
    null
  );
  const [hours, setHours] = useState<number>(event.defaultHours ?? 0);
  const [submitting, setSubmitting] = useState(false);

  const trimmed = debouncedSearch.trim();

  // Fire a server-side ILIKE substring query whenever there's any input.
  // Filters to active members, optionally scoped to the event's chapter to
  // keep result sets small. Limited to 25 hits.
  useEffect(() => {
    let cancelled = false;
    if (trimmed.length === 0) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const constraints: QueryConstraint[] = [where("activeStatus", "==", "Active")];
    if (scopeChapter && event.chapterId) {
      constraints.push(where("chapterId", "==", event.chapterId));
    }
    constraints.push(where("name", "ilike", `%${escapeLike(trimmed)}%`));
    constraints.push(orderBy("name"));
    constraints.push(fsLimit(25));

    getDocs(query(collection("members"), ...constraints))
      .then((snap) => {
        if (cancelled) return;
        setResults(
          snap.docs.map((d) => ({ ...(d.data() as Member), id: d.id }))
        );
      })
      .catch((err) => {
        if (!cancelled) console.error("Member search failed", err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [trimmed, scopeChapter, event.chapterId]);

  const isConference = event.eventType === "conference";
  const effectiveHours = isConference ? (event.defaultHours ?? 0) : hours;

  const submit = async () => {
    if (!selected) return;
    setSubmitting(true);
    try {
      await addManualAttendee({
        eventId: event.id,
        member: selected,
        hours: effectiveHours,
        user: user?.email || "",
      });
      // Mirror the doc that addManualAttendee just wrote so the parent list
      // updates without a re-fetch.
      onAdded({
        id: manualAttendeeId(event.id, selected.id),
        registrationId: manualAttendeeId(event.id, selected.id),
        eventId: event.id,
        contactId: selected.id,
        name: selected.name,
        attended: true,
        hours: effectiveHours,
        attendedSubeventIds: [],
        source: "app",
        memberId: selected.id,
        registrationTypeId: "",
        registrationType: "",
        organization: "",
        isPaid: false,
        registrationFee: 0,
        paidSum: 0,
        OnWaitlist: false,
        Status: "",
      });
      toast.success(`${selected.name} added`);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to add attendee";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add Attendee</DialogTitle>
        <DialogDescription>
          Search active members by name.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search by name…"
          className="w-full"
        />

        {event.chapterId && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={scopeChapter}
              onChange={(e) => setScopeChapter(e.target.checked)}
              className="rounded border-input"
            />
            Limit to {nameFor(event.chapterId)}
          </label>
        )}

        {selected ? (
          <div className="rounded-md border p-3 flex items-center justify-between bg-muted/40">
            <div>
              <p className="font-medium text-sm">{selected.name}</p>
              <p className="text-xs text-muted-foreground">
                {selected.email} · {nameFor(selected.chapterId) || "No chapter"}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelected(null)}
            >
              Change
            </Button>
          </div>
        ) : trimmed.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Type any part of a member name to search.
          </p>
        ) : (
          <ScrollArea className="h-64 rounded-md border">
            {loading ? (
              <p className="text-sm text-muted-foreground p-3">Loading…</p>
            ) : results.length === 0 ? (
              <p className="text-sm text-muted-foreground p-3">
                No active members match.
              </p>
            ) : (
              <ul className="divide-y">
                {results.map((m) => {
                  const alreadyAdded = existingMemberIds.has(m.id);
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        disabled={alreadyAdded}
                        onClick={() => setSelected(m)}
                        className="w-full text-left p-3 hover:bg-muted/50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-between"
                      >
                        <div>
                          <p className="font-medium text-sm">{m.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {m.email} · {nameFor(m.chapterId) || "No chapter"}
                          </p>
                        </div>
                        {alreadyAdded && (
                          <span className="text-xs text-muted-foreground">
                            already added
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </ScrollArea>
        )}

        {selected && (
          <div className="space-y-1">
            <label className="text-sm font-medium">Hours</label>
            {isConference ? (
              <p className="text-sm text-muted-foreground">
                Conferences use the event's default hours:{" "}
                <span className="font-medium text-foreground">
                  {event.defaultHours ?? 0}
                </span>
              </p>
            ) : (
              <Input
                type="number"
                min={0}
                step="0.5"
                value={hours}
                onChange={(e) => setHours(Number(e.target.value) || 0)}
              />
            )}
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={!selected || submitting}>
          {submitting ? "Adding…" : "Add Attendee"}
        </Button>
      </DialogFooter>
    </>
  );
}
