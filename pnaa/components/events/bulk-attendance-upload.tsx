"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Upload, Download, FileText, Check, AlertTriangle, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/hooks/use-auth";
import { useSubevents } from "@/hooks/use-subevents";
import {
  addManualAttendee,
  addSubeventToEvent,
  bulkSetSubeventAttendance,
  fetchAllAttendees,
  manualAttendeeId,
  type BulkSubeventRow,
} from "@/lib/supabase/attendees";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { parseCSV, parseBoolean as parseAttended, downloadCsv } from "@/lib/csv";
import type { Attendee } from "@/types/attendee";
import type { AppEvent } from "@/types/event";
import type { Member } from "@/types/member";

interface BulkAttendanceUploadProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: AppEvent & { id: string };
  onApplied?: () => void;
}

// ---------- Resolution types ----------

type Resolution =
  | {
      kind: "ready";
      attendeeId: string;
      subeventId: string;
      attended: boolean;
    }
  | {
      kind: "ambiguous_attendee";
      candidates: { id: string; label: string }[];
      subeventId: string;
      attended: boolean;
      pickedId?: string;
    }
  | {
      kind: "missing_attendee_with_members";
      candidates: { id: string; label: string }[];
      memberId?: string;
      subeventId: string;
      attended: boolean;
    }
  | {
      kind: "missing_attendee_no_members";
      subeventId: string;
      attended: boolean;
    }
  | {
      kind: "unknown_subevent";
      subeventName: string;
      attendeeId: string;
      attended: boolean;
    }
  | {
      kind: "bad_attended_value";
      raw: string;
    }
  | { kind: "skipped" };

interface ParsedRow {
  index: number; // 1-based row in source CSV (after header)
  rawName: string;
  rawSubevent: string;
  rawAttended: string;
  resolution: Resolution;
}

const TEMPLATE_CSV = [
  "Name,Sub-Event,Attended",
  "Jane Doe,Opening Keynote,yes",
  "Jane Doe,Workshop A,no",
  "John Smith,Opening Keynote,yes",
].join("\n");

function downloadTemplate() {
  downloadCsv("subevent-attendance-template.csv", TEMPLATE_CSV);
}

// ---------- Main component ----------

export function BulkAttendanceUpload({
  open,
  onOpenChange,
  event,
  onApplied,
}: BulkAttendanceUploadProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        {open && (
          <BulkAttendanceBody
            event={event}
            onClose={() => onOpenChange(false)}
            onApplied={onApplied}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function BulkAttendanceBody({
  event,
  onClose,
  onApplied,
}: {
  event: AppEvent & { id: string };
  onClose: () => void;
  onApplied?: () => void;
}) {
  const { user } = useAuth();
  const { byId: subeventById } = useSubevents();
  const eventSubeventIds = useMemo(
    () => event.subeventIds ?? [],
    [event.subeventIds]
  );
  const eventSubeventNameLower = useMemo(() => {
    const map = new Map<string, string>();
    for (const id of eventSubeventIds) {
      const name = subeventById.get(id)?.name;
      if (name) map.set(name.toLowerCase(), id);
    }
    return map;
  }, [eventSubeventIds, subeventById]);

  const [attendees, setAttendees] = useState<(Attendee & { id: string })[] | null>(
    null
  );
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [parsing, setParsing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // Load every attendee once when the modal opens — the bulk upload needs the
  // full picture, not just the current paginated page.
  useEffect(() => {
    let cancelled = false;
    fetchAllAttendees(event.id)
      .then((list) => {
        if (!cancelled) setAttendees(list);
      })
      .catch((err) => {
        console.error("Failed to load attendees for bulk upload", err);
        if (!cancelled) toast.error("Failed to load existing attendees");
      });
    return () => {
      cancelled = true;
    };
  }, [event.id]);

  const attendeesByNameLower = useMemo(() => {
    const map = new Map<string, (Attendee & { id: string })[]>();
    for (const a of attendees ?? []) {
      const key = (a.name ?? "").trim().toLowerCase();
      if (!key) continue;
      const cur = map.get(key) ?? [];
      cur.push(a);
      map.set(key, cur);
    }
    return map;
  }, [attendees]);

  const analyzeRow = async (
    raw: { name: string; sub: string; att: string; index: number }
  ): Promise<ParsedRow> => {
    const attendedParsed = parseAttended(raw.att);
    if (attendedParsed === null) {
      return {
        index: raw.index,
        rawName: raw.name,
        rawSubevent: raw.sub,
        rawAttended: raw.att,
        resolution: { kind: "bad_attended_value", raw: raw.att },
      };
    }

    const subKey = raw.sub.trim().toLowerCase();
    const subeventId = eventSubeventNameLower.get(subKey);
    const nameKey = raw.name.trim().toLowerCase();
    const matches = attendeesByNameLower.get(nameKey) ?? [];

    if (!subeventId) {
      return {
        index: raw.index,
        rawName: raw.name,
        rawSubevent: raw.sub,
        rawAttended: raw.att,
        resolution: {
          kind: "unknown_subevent",
          subeventName: raw.sub.trim(),
          attendeeId: matches[0]?.id ?? "",
          attended: attendedParsed,
        },
      };
    }

    if (matches.length === 1) {
      return {
        index: raw.index,
        rawName: raw.name,
        rawSubevent: raw.sub,
        rawAttended: raw.att,
        resolution: {
          kind: "ready",
          attendeeId: matches[0].id,
          subeventId,
          attended: attendedParsed,
        },
      };
    }

    if (matches.length > 1) {
      return {
        index: raw.index,
        rawName: raw.name,
        rawSubevent: raw.sub,
        rawAttended: raw.att,
        resolution: {
          kind: "ambiguous_attendee",
          candidates: matches.map((m) => ({
            id: m.id,
            label: `${m.name} · ${m.source === "wildapricot" ? "WA" : "Manual"}`,
          })),
          subeventId,
          attended: attendedParsed,
        },
      };
    }

    // No attendee match — look up the members table for a unique active match.
    const memberCandidates = await searchMembersByName(raw.name.trim());
    if (memberCandidates.length === 0) {
      return {
        index: raw.index,
        rawName: raw.name,
        rawSubevent: raw.sub,
        rawAttended: raw.att,
        resolution: {
          kind: "missing_attendee_no_members",
          subeventId,
          attended: attendedParsed,
        },
      };
    }
    return {
      index: raw.index,
      rawName: raw.name,
      rawSubevent: raw.sub,
      rawAttended: raw.att,
      resolution: {
        kind: "missing_attendee_with_members",
        candidates: memberCandidates.map((m) => ({
          id: m.id,
          label: `${m.name} · ${m.email}`,
        })),
        memberId: memberCandidates.length === 1 ? memberCandidates[0].id : undefined,
        subeventId,
        attended: attendedParsed,
      },
    };
  };

  const handleFile = async (file: File) => {
    if (!attendees) {
      toast.error("Still loading existing attendees, try again in a moment");
      return;
    }
    setParsing(true);
    try {
      const text = await file.text();
      const grid = parseCSV(text);
      if (grid.length === 0) {
        toast.error("CSV is empty");
        return;
      }
      // Detect and skip header row if first row's last cell isn't a valid attended value.
      const first = grid[0];
      const hasHeader =
        first.length >= 3 && parseAttended(first[first.length - 1]) === null;
      const dataRows = hasHeader ? grid.slice(1) : grid;
      const triples = dataRows
        .map((r, i) => ({
          name: r[0] ?? "",
          sub: r[1] ?? "",
          att: r[2] ?? "",
          index: i + 1 + (hasHeader ? 1 : 0),
        }))
        .filter((r) => r.name.trim() || r.sub.trim() || r.att.trim());

      const analyzed = await Promise.all(triples.map(analyzeRow));
      setRows(analyzed);
    } catch (err) {
      console.error(err);
      toast.error("Failed to parse CSV");
    } finally {
      setParsing(false);
    }
  };

  // ---------- per-row resolution mutators ----------

  const updateRow = (index: number, patch: Partial<ParsedRow>) => {
    setRows((cur) =>
      cur.map((r) => (r.index === index ? { ...r, ...patch } : r))
    );
  };

  const resolveAmbiguousPick = (rowIndex: number, attendeeId: string) => {
    setRows((cur) =>
      cur.map((r) => {
        if (r.index !== rowIndex || r.resolution.kind !== "ambiguous_attendee")
          return r;
        return {
          ...r,
          resolution: {
            kind: "ready",
            attendeeId,
            subeventId: r.resolution.subeventId,
            attended: r.resolution.attended,
          },
        };
      })
    );
  };

  const addMemberAsAttendee = async (rowIndex: number, memberId: string) => {
    const row = rows.find((r) => r.index === rowIndex);
    if (!row || row.resolution.kind !== "missing_attendee_with_members") return;
    const member = await fetchMember(memberId);
    if (!member) {
      toast.error("Member lookup failed");
      return;
    }
    try {
      await addManualAttendee({
        eventId: event.id,
        member,
        hours: 0, // National conference hours derive from sub-events.
        user: user?.email || "",
      });
      // Push the new attendee into local state so other rows with this name resolve.
      const id = manualAttendeeId(event.id, memberId);
      const newAttendee: Attendee & { id: string } = {
        id,
        registrationId: id,
        eventId: event.id,
        contactId: memberId,
        name: member.name,
        attended: false,
        hours: 0,
        attendedSubeventIds: [],
        source: "app",
        memberId,
        registrationTypeId: "",
        registrationType: "",
        organization: "",
        isPaid: false,
        registrationFee: 0,
        paidSum: 0,
        OnWaitlist: false,
        Status: "",
      };
      setAttendees((cur) => [...(cur ?? []), newAttendee]);
      updateRow(rowIndex, {
        resolution: {
          kind: "ready",
          attendeeId: id,
          subeventId: row.resolution.subeventId,
          attended: row.resolution.attended,
        },
      });
      toast.success(`${member.name} added`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add attendee");
    }
  };

  const createMissingSubevent = async (rowIndex: number) => {
    const row = rows.find((r) => r.index === rowIndex);
    if (!row || row.resolution.kind !== "unknown_subevent") return;
    try {
      const newId = await addSubeventToEvent({
        eventId: event.id,
        name: row.resolution.subeventName,
        user: user?.email || "",
      });
      // Re-analyze every row that referenced this sub-event name.
      const subKey = row.resolution.subeventName.trim().toLowerCase();
      setRows((cur) =>
        cur.map((r) => {
          if (
            r.resolution.kind === "unknown_subevent" &&
            r.resolution.subeventName.trim().toLowerCase() === subKey
          ) {
            const attendeeMatches =
              attendeesByNameLower.get(r.rawName.trim().toLowerCase()) ?? [];
            if (attendeeMatches.length === 1) {
              return {
                ...r,
                resolution: {
                  kind: "ready",
                  attendeeId: attendeeMatches[0].id,
                  subeventId: newId,
                  attended: r.resolution.attended,
                },
              };
            }
            // Otherwise treat as missing/ambiguous — handled in next render.
          }
          return r;
        })
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create sub-event");
    }
  };

  const skipRow = (rowIndex: number) => {
    updateRow(rowIndex, { resolution: { kind: "skipped" } });
  };

  // ---------- summary + apply ----------

  const readyRows = rows.filter((r) => r.resolution.kind === "ready");
  const conflictRows = rows.filter(
    (r) => r.resolution.kind !== "ready" && r.resolution.kind !== "skipped"
  );
  const skippedRows = rows.filter((r) => r.resolution.kind === "skipped");

  const applyAll = async () => {
    if (readyRows.length === 0) {
      toast.message("No matched rows to apply");
      return;
    }
    setApplying(true);
    try {
      const bulkRows: BulkSubeventRow[] = readyRows.map((r) => {
        const res = r.resolution as Extract<Resolution, { kind: "ready" }>;
        return {
          attendeeId: res.attendeeId,
          subeventId: res.subeventId,
          attended: res.attended,
        };
      });
      await bulkSetSubeventAttendance({
        eventId: event.id,
        rows: bulkRows,
        user: user?.email || "",
      });
      toast.success(
        `Applied ${readyRows.length} row${readyRows.length === 1 ? "" : "s"}`
      );
      onApplied?.();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bulk apply failed");
    } finally {
      setApplying(false);
    }
  };

  // ---------- render ----------

  const hasData = rows.length > 0;
  const showDropzone = !hasData;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Bulk Sub-Event Attendance</DialogTitle>
        <DialogDescription>
          Upload a CSV to mark sub-event attendance in bulk. Rows that don&apos;t
          match an existing attendee or sub-event will be flagged for you to
          resolve before applying.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Button type="button" variant="outline" onClick={downloadTemplate}>
            <Download className="h-4 w-4 mr-1.5" />
            Download Template
          </Button>
          {hasData && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setRows([])}
            >
              Clear & re-upload
            </Button>
          )}
        </div>

        {showDropzone && (
          <label
            className={
              "flex flex-col items-center justify-center rounded-md border-2 border-dashed py-10 cursor-pointer transition " +
              (dragOver ? "bg-muted/50 border-primary" : "border-muted")
            }
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files?.[0];
              if (file) handleFile(file);
            }}
          >
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
            <Upload className="h-6 w-6 text-muted-foreground mb-2" />
            <p className="text-sm font-medium">
              {parsing
                ? "Parsing..."
                : attendees === null
                  ? "Loading existing attendees..."
                  : "Drop a CSV here or click to choose"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Columns: Name, Sub-Event, Attended
            </p>
          </label>
        )}

        {hasData && (
          <>
            <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
              <Badge variant="outline" className="border-green-200 text-green-700 bg-green-50 dark:bg-green-950/30">
                <Check className="h-3 w-3 mr-1" />
                {readyRows.length} matched
              </Badge>
              {conflictRows.length > 0 && (
                <Badge
                  variant="outline"
                  className="border-amber-200 text-amber-700 bg-amber-50 dark:bg-amber-950/30"
                >
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  {conflictRows.length} need{conflictRows.length === 1 ? "s" : ""} resolution
                </Badge>
              )}
              {skippedRows.length > 0 && (
                <Badge variant="outline" className="text-muted-foreground">
                  {skippedRows.length} skipped
                </Badge>
              )}
            </div>

            <ScrollArea className="h-72 rounded-md border">
              <ul className="divide-y">
                {rows.map((row) => (
                  <RowRow
                    key={row.index}
                    row={row}
                    eventSubeventIds={eventSubeventIds}
                    subeventById={subeventById}
                    onPickAmbiguous={(id) => resolveAmbiguousPick(row.index, id)}
                    onAddMember={(memberId) =>
                      addMemberAsAttendee(row.index, memberId)
                    }
                    onPickMemberCandidate={(memberId) => {
                      // Update the local memberId; user must then click "Add"
                      setRows((cur) =>
                        cur.map((r) =>
                          r.index === row.index &&
                          r.resolution.kind === "missing_attendee_with_members"
                            ? {
                                ...r,
                                resolution: { ...r.resolution, memberId },
                              }
                            : r
                        )
                      );
                    }}
                    onCreateSubevent={() => createMissingSubevent(row.index)}
                    onSkip={() => skipRow(row.index)}
                  />
                ))}
              </ul>
            </ScrollArea>
          </>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={applying}>
          Cancel
        </Button>
        <Button
          onClick={applyAll}
          disabled={!hasData || applying || readyRows.length === 0}
        >
          {applying
            ? "Applying..."
            : `Apply ${readyRows.length} matched row${readyRows.length === 1 ? "" : "s"}`}
        </Button>
      </DialogFooter>
    </>
  );
}

function RowRow({
  row,
  subeventById,
  onPickAmbiguous,
  onAddMember,
  onPickMemberCandidate,
  onCreateSubevent,
  onSkip,
}: {
  row: ParsedRow;
  eventSubeventIds: string[];
  subeventById: Map<string, { id: string; name: string; archived: boolean }>;
  onPickAmbiguous: (attendeeId: string) => void;
  onAddMember: (memberId: string) => void;
  onPickMemberCandidate: (memberId: string) => void;
  onCreateSubevent: () => void;
  onSkip: () => void;
}) {
  const res = row.resolution;

  if (res.kind === "ready") {
    return (
      <li className="p-3 flex items-start gap-3">
        <Check className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm">
            <span className="font-medium">{row.rawName}</span>
            <span className="mx-1.5 text-muted-foreground">·</span>
            <span>{subeventById.get(res.subeventId)?.name ?? row.rawSubevent}</span>
            <span className="mx-1.5 text-muted-foreground">·</span>
            <span className="text-muted-foreground">
              {res.attended ? "attended" : "not attended"}
            </span>
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7"
          onClick={onSkip}
          aria-label="Skip"
        >
          Skip
        </Button>
      </li>
    );
  }

  if (res.kind === "skipped") {
    return (
      <li className="p-3 flex items-center gap-3 opacity-50">
        <X className="h-4 w-4 text-muted-foreground shrink-0" />
        <p className="text-sm flex-1 min-w-0 truncate">
          Row {row.index}: <span className="line-through">{row.rawName}</span>
        </p>
      </li>
    );
  }

  if (res.kind === "bad_attended_value") {
    return (
      <li className="p-3 flex items-start gap-3 bg-amber-50/40 dark:bg-amber-950/10">
        <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm">
            Row {row.index}: <span className="font-medium">{row.rawName}</span>
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Couldn't interpret "{res.raw}" as yes/no.
          </p>
        </div>
        <Button variant="ghost" size="sm" className="h-7" onClick={onSkip}>
          Skip
        </Button>
      </li>
    );
  }

  if (res.kind === "ambiguous_attendee") {
    return (
      <li className="p-3 flex items-start gap-3 bg-amber-50/40 dark:bg-amber-950/10">
        <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0 space-y-2">
          <div>
            <p className="text-sm">
              <span className="font-medium">{row.rawName}</span>
              <span className="mx-1.5 text-muted-foreground">·</span>
              <span>{subeventById.get(res.subeventId)?.name ?? row.rawSubevent}</span>
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Multiple attendees match this name. Pick which one.
            </p>
          </div>
          <Select
            value={res.pickedId ?? ""}
            onValueChange={(v) => onPickAmbiguous(v)}
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="Pick attendee..." />
            </SelectTrigger>
            <SelectContent>
              {res.candidates.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="ghost" size="sm" className="h-7" onClick={onSkip}>
          Skip
        </Button>
      </li>
    );
  }

  if (res.kind === "missing_attendee_with_members") {
    return (
      <li className="p-3 flex items-start gap-3 bg-amber-50/40 dark:bg-amber-950/10">
        <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0 space-y-2">
          <div>
            <p className="text-sm">
              <span className="font-medium">{row.rawName}</span>
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Not on the attendee list yet. Found {res.candidates.length} member
              match{res.candidates.length === 1 ? "" : "es"}.
            </p>
          </div>
          {res.candidates.length > 1 && (
            <Select
              value={res.memberId ?? ""}
              onValueChange={(v) => onPickMemberCandidate(v)}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Pick member..." />
              </SelectTrigger>
              <SelectContent>
                {res.candidates.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            size="sm"
            disabled={!res.memberId}
            onClick={() => res.memberId && onAddMember(res.memberId)}
          >
            Add as manual attendee
          </Button>
        </div>
        <Button variant="ghost" size="sm" className="h-7" onClick={onSkip}>
          Skip
        </Button>
      </li>
    );
  }

  if (res.kind === "missing_attendee_no_members") {
    return (
      <li className="p-3 flex items-start gap-3 bg-amber-50/40 dark:bg-amber-950/10">
        <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm">
            <span className="font-medium">{row.rawName}</span>
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            No attendee or active member matches this name exactly.
          </p>
        </div>
        <Button variant="ghost" size="sm" className="h-7" onClick={onSkip}>
          Skip
        </Button>
      </li>
    );
  }

  if (res.kind === "unknown_subevent") {
    return (
      <li className="p-3 flex items-start gap-3 bg-amber-50/40 dark:bg-amber-950/10">
        <FileText className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0 space-y-2">
          <div>
            <p className="text-sm">
              <span className="font-medium">{row.rawName}</span>
              <span className="mx-1.5 text-muted-foreground">·</span>
              <span>{res.subeventName}</span>
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              "{res.subeventName}" isn't a sub-event on this conference yet.
            </p>
          </div>
          <Button size="sm" onClick={onCreateSubevent}>
            Create &amp; attach to event
          </Button>
        </div>
        <Button variant="ghost" size="sm" className="h-7" onClick={onSkip}>
          Skip
        </Button>
      </li>
    );
  }

  return null;
}

// ---------- helpers ----------

async function searchMembersByName(name: string): Promise<(Member & { id: string })[]> {
  if (!name) return [];
  const supabase = getSupabaseBrowser();
  const { data, error } = await supabase
    .from("members")
    .select("*")
    .ilike("name", name)
    .limit(10);
  if (error) {
    console.error("Member search failed", error);
    return [];
  }
  return (data ?? []) as (Member & { id: string })[];
}

async function fetchMember(id: string): Promise<(Member & { id: string }) | null> {
  const supabase = getSupabaseBrowser();
  const { data, error } = await supabase
    .from("members")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error(error);
    return null;
  }
  return (data ?? null) as (Member & { id: string }) | null;
}
