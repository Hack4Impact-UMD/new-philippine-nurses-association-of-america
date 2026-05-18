"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  collectionGroup,
  onSnapshot,
  query,
  where,
} from "@/lib/supabase/firestore";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { hydrateTimestamps } from "@/lib/supabase/timestamp";
import { useDocumentOnce } from "@/hooks/use-firestore";
import { useChaptersMap } from "@/hooks/use-chapters-map";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  AdvancedDataTable,
  type ColumnDef,
  type ColumnMeta,
} from "@/components/shared/advanced-data-table";
import { User, Clock, Calendar, Award } from "lucide-react";
import { formatDate } from "@/lib/utils";
import {
  EVENT_TYPE_LABELS,
  EVENT_SUBTYPE_LABELS,
  type AppEvent,
} from "@/types/event";
import type { Member } from "@/types/member";
import type { Attendee } from "@/types/attendee";

interface AttendedEventRow {
  id: string;
  eventId: string;
  eventName: string;
  startDate: string;
  chapter: string;
  region: string;
  eventType: AppEvent["eventType"];
  eventSubtype: AppEvent["eventSubtype"];
  hours: number;
  archived: boolean;
}

export function MemberDetail({ memberId }: { memberId: string }) {
  const router = useRouter();
  const { nameFor, regionFor } = useChaptersMap();
  const { data: member, loading: memberLoading } = useDocumentOnce<Member>(
    "members",
    memberId
  );

  const [attendances, setAttendances] = useState<
    (Attendee & { id: string; eventId: string })[]
  >([]);
  const [eventsById, setEventsById] = useState<Map<string, AppEvent & { id: string }>>(
    new Map()
  );
  const [attendanceLoading, setAttendanceLoading] = useState(true);

  // Live subscription to all of this member's attended attendee subdocs.
  useEffect(() => {
    setAttendanceLoading(true);
    const q = query(
      collectionGroup("attendees"),
      where("memberId", "==", memberId),
      where("attended", "==", true)
    );
    const unsub = onSnapshot(
      q,
      async (snap) => {
        const rows = snap.docs.map((d) => ({
          ...(d.data() as Attendee),
          id: d.id,
          eventId: d.ref.parent.parent!.id,
        }));
        setAttendances(rows);

        // Fetch any event docs we don't already have cached. One round-trip
        // (`select … where id in (…)`) instead of N parallel single-row reads.
        const needed = new Set(rows.map((r) => r.eventId));
        const fetched = new Map(eventsById);
        const missing = [...needed].filter((id) => !fetched.has(id));
        if (missing.length > 0) {
          const { data: eventRows, error: evErr } = await getSupabaseBrowser()
            .from("events")
            .select("*")
            .in("id", missing);
          if (!evErr) {
            for (const row of eventRows ?? []) {
              const hydrated = hydrateTimestamps(
                row as Record<string, unknown>
              ) as unknown as AppEvent & { id: string };
              fetched.set(hydrated.id, hydrated);
            }
            setEventsById(fetched);
          }
        }
        setAttendanceLoading(false);
      },
      () => setAttendanceLoading(false)
    );
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId]);

  const eventRows: AttendedEventRow[] = useMemo(() => {
    return attendances
      .map((a) => {
        const ev = eventsById.get(a.eventId);
        if (!ev) return null;
        return {
          id: a.id,
          eventId: a.eventId,
          eventName: ev.name,
          startDate: ev.startDate,
          chapter: nameFor(ev.chapterId),
          region: regionFor(ev.chapterId),
          eventType: ev.eventType,
          eventSubtype: ev.eventSubtype,
          hours: Number(a.hours ?? 0),
          archived: ev.archived,
        };
      })
      .filter((r): r is AttendedEventRow => r !== null)
      .sort((a, b) => (a.startDate > b.startDate ? -1 : 1));
  }, [attendances, eventsById, nameFor, regionFor]);

  const stats = useMemo(() => {
    let totalHours = 0;
    let conferenceHours = 0;
    let outreachHours = 0;
    for (const r of eventRows) {
      totalHours += r.hours;
      if (r.eventType === "conference") conferenceHours += r.hours;
      else if (r.eventType === "community_outreach") outreachHours += r.hours;
    }
    return {
      totalHours,
      conferenceHours,
      outreachHours,
      eventsAttended: eventRows.length,
    };
  }, [eventRows]);

  const columns: ColumnDef<AttendedEventRow, unknown>[] = useMemo(
    () => [
      {
        accessorKey: "eventName",
        header: "Event",
        size: 280,
        enableSorting: true,
        meta: { filterType: "text" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="font-medium text-sm">{row.original.eventName}</span>
        ),
      },
      {
        accessorKey: "startDate",
        header: "Date",
        size: 120,
        enableSorting: true,
        cell: ({ row }) => (
          <span className="tabular-nums text-sm">
            {formatDate(row.original.startDate)}
          </span>
        ),
      },
      {
        accessorKey: "eventType",
        header: "Type",
        size: 200,
        enableSorting: true,
        meta: {
          filterType: "select",
          filterOptions: [
            { label: "Conference", value: "conference" },
            { label: "Community Outreach", value: "community_outreach" },
          ],
        } satisfies ColumnMeta,
        cell: ({ row }) =>
          row.original.eventType ? (
            <Badge variant="secondary" className="text-xs font-normal">
              {EVENT_TYPE_LABELS[row.original.eventType]}
              {row.original.eventSubtype
                ? ` · ${EVENT_SUBTYPE_LABELS[row.original.eventSubtype]}`
                : ""}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: "chapter",
        header: "Chapter",
        size: 180,
        enableSorting: true,
        meta: { filterType: "text" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.chapter || "—"}
          </span>
        ),
      },
      {
        accessorKey: "hours",
        header: "Hours",
        size: 100,
        enableSorting: true,
        cell: ({ row }) => (
          <span className="font-semibold tabular-nums text-sm">
            {row.original.hours}
          </span>
        ),
      },
    ],
    []
  );

  if (memberLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 md:grid-cols-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!member) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold">Member not found</h2>
        <Link
          href="/members"
          className="text-primary hover:underline mt-2 inline-block"
        >
          Back to members
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
            <User className="h-6 w-6 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold">{member.name}</h1>
              <StatusBadge
                variant={member.activeStatus === "Active" ? "active" : "lapsed"}
              />
            </div>
            <p className="text-muted-foreground text-sm">{member.email}</p>
            <p className="text-muted-foreground text-sm">
              {nameFor(member.chapterId) || "No chapter"}
              {member.region ? ` · ${member.region}` : ""}
              {member.membershipLevel ? ` · ${member.membershipLevel}` : ""}
            </p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <Clock className="h-5 w-5 text-primary" />
            <div>
              <p className="text-2xl font-bold tabular-nums">
                {stats.totalHours}
              </p>
              <p className="text-xs text-muted-foreground">Total Hours</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <Calendar className="h-5 w-5 text-primary" />
            <div>
              <p className="text-2xl font-bold tabular-nums">
                {stats.eventsAttended}
              </p>
              <p className="text-xs text-muted-foreground">Events Attended</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <Award className="h-5 w-5 text-blue-600" />
            <div>
              <p className="text-2xl font-bold tabular-nums">
                {stats.conferenceHours}
              </p>
              <p className="text-xs text-muted-foreground">Conference Hours</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <Award className="h-5 w-5 text-green-600" />
            <div>
              <p className="text-2xl font-bold tabular-nums">
                {stats.outreachHours}
              </p>
              <p className="text-xs text-muted-foreground">Outreach Hours</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Events */}
      <div className="space-y-2">
        <h3 className="text-base font-semibold">Events Attended</h3>
        <AdvancedDataTable<AttendedEventRow>
          columns={columns}
          data={eventRows}
          loading={attendanceLoading}
          onRowClick={(row) => router.push(`/events/${row.eventId}`)}
          emptyTitle="No events attended"
          emptyDescription="This member hasn't been marked attended on any events yet"
          emptyIcon={Calendar}
          defaultPageSize={20}
          exportFilename={`PNAA_${memberId}_events`}
        />
      </div>
    </div>
  );
}
