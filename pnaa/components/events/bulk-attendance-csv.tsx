"use client";

import { useMemo, useRef } from "react";
import { Check, AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BulkUploadDialog,
  type BulkUploadAdapter,
  type RowApi,
  type RowStatus,
} from "@/components/shared/bulk-upload-dialog";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { splitHeader, col, parseBoolean } from "@/lib/csv";
import {
  bulkSetAttendance,
  fetchAllAttendees,
  type BulkAttendanceRow,
} from "@/lib/supabase/attendees";
import type { Attendee } from "@/types/attendee";
import type { Member } from "@/types/member";
import type { AppEvent } from "@/types/event";

// ---------- Row + resolution types ----------

type Candidate = { memberId: string; label: string };

type AttResolution =
  | { kind: "ready"; memberId: string; name: string; attended: boolean; hours?: number }
  | { kind: "ambiguous"; candidates: Candidate[]; attended: boolean; hours?: number; pickedId?: string }
  | { kind: "inactive_member"; memberId: string; name: string; attended: boolean; hours?: number }
  | { kind: "no_match" }
  | { kind: "bad_attended"; raw: string }
  | { kind: "invalid"; reason: string }
  | { kind: "skipped" };

interface AttRow {
  key: string;
  index: number;
  rawName: string;
  rawEmail: string;
  resolution: AttResolution;
}

type MemberLite = Pick<Member, "name" | "email" | "activeStatus"> & { id: string };

const KNOWN_HEADERS = ["name", "email", "attended", "hours"];

const TEMPLATE_CSV = [
  "Name,Email,Attended,Hours",
  "Jane Doe,jane@example.com,yes,2",
  "John Smith,,yes,",
].join("\n");

// undefined = blank (no override), null = malformed (surfaced as a conflict so
// e.g. "two" isn't silently dropped).
function parseHours(raw: string): number | null | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

async function searchMembersByName(name: string): Promise<MemberLite[]> {
  if (!name) return [];
  const supabase = getSupabaseBrowser();
  const { data, error } = await supabase
    .from("members")
    .select("id,name,email,activeStatus")
    .ilike("name", name)
    .limit(10);
  if (error) {
    console.error("Member name search failed", error);
    return [];
  }
  return (data ?? []) as MemberLite[];
}

// ---------- Adapter ----------

function useAttendanceAdapter(
  event: AppEvent & { id: string }
): BulkUploadAdapter<AttRow> {
  // Lookup data loaded in prepare(); held in a ref so the adapter stays stable.
  const attendeesByNameLower = useRef(new Map<string, (Attendee & { id: string })[]>());

  return useMemo<BulkUploadAdapter<AttRow>>(() => {
    const prepare = async () => {
      const list = await fetchAllAttendees(event.id);
      const byName = new Map<string, (Attendee & { id: string })[]>();
      for (const a of list) {
        const key = (a.name ?? "").trim().toLowerCase();
        if (key) {
          const cur = byName.get(key) ?? [];
          cur.push(a);
          byName.set(key, cur);
        }
      }
      attendeesByNameLower.current = byName;
    };

    const attendeeCandidate = (a: Attendee & { id: string }): Candidate => ({
      memberId: a.memberId,
      label: `${a.name} · ${a.source === "wildapricot" ? "WA" : "Manual"}`,
    });

    const memberCandidate = (m: MemberLite): Candidate => ({
      memberId: m.id,
      label: `${m.name} · ${m.email || "no email"} · ${m.activeStatus}`,
    });

    const analyze = async (grid: string[][]): Promise<AttRow[]> => {
      const { headerMap, dataRows } = splitHeader(grid, KNOWN_HEADERS);
      const parsed = dataRows
        .map((r, i) => ({
          index: i + 1,
          name: col(r, headerMap, "name", 0),
          email: col(r, headerMap, "email", 1),
          attended: col(r, headerMap, "attended", 2),
          hours: col(r, headerMap, "hours", 3),
        }))
        .filter((p) => p.name || p.email);

      // Batch the precise path: one query for every email present.
      const emails = [...new Set(parsed.map((p) => p.email.trim()).filter(Boolean))];
      const byEmail = new Map<string, MemberLite>();
      if (emails.length > 0) {
        const supabase = getSupabaseBrowser();
        const { data } = await supabase
          .from("members")
          .select("id,name,email,activeStatus")
          .in("email", emails);
        for (const m of (data ?? []) as MemberLite[]) {
          if (m.email) byEmail.set(m.email.toLowerCase(), m);
        }
      }

      const byName = attendeesByNameLower.current;

      // Phase 1: classify; defer rows needing a member name lookup.
      type Pending = {
        index: number;
        name: string;
        email: string;
        attended: boolean;
        hours?: number;
      };
      const deferred: Pending[] = [];
      const rows: AttRow[] = parsed.map((p) => {
        const base = { key: String(p.index), index: p.index, rawName: p.name, rawEmail: p.email };
        const attended = parseBoolean(p.attended);
        if (attended === null) {
          return { ...base, resolution: { kind: "bad_attended", raw: p.attended } };
        }
        const hours = parseHours(p.hours);
        if (hours === null) {
          return { ...base, resolution: { kind: "invalid", reason: `Couldn't read hours "${p.hours}".` } };
        }

        // Email is the precise key.
        const m = p.email ? byEmail.get(p.email.trim().toLowerCase()) : undefined;
        if (m) {
          if (m.activeStatus === "Active") {
            return { ...base, resolution: { kind: "ready", memberId: m.id, name: m.name, attended, hours } };
          }
          return { ...base, resolution: { kind: "inactive_member", memberId: m.id, name: m.name, attended, hours } };
        }

        // Name fallback against existing attendees (in-memory).
        const matches = byName.get(p.name.trim().toLowerCase()) ?? [];
        if (matches.length === 1) {
          return {
            ...base,
            resolution: { kind: "ready", memberId: matches[0].memberId, name: matches[0].name, attended, hours },
          };
        }
        if (matches.length > 1) {
          return {
            ...base,
            resolution: { kind: "ambiguous", candidates: matches.map(attendeeCandidate), attended, hours },
          };
        }
        // No attendee match — defer to a members-by-name lookup.
        deferred.push({ index: p.index, name: p.name, email: p.email, attended, hours });
        return { ...base, resolution: { kind: "no_match" } };
      });

      // Phase 2: resolve deferred rows with one ilike query per distinct name.
      const distinctNames = [...new Set(deferred.map((d) => d.name.trim()).filter(Boolean))];
      const membersByNameLower = new Map<string, MemberLite[]>();
      await Promise.all(
        distinctNames.map(async (n) => {
          membersByNameLower.set(n.toLowerCase(), await searchMembersByName(n));
        })
      );
      const rowByIndex = new Map(rows.map((r) => [r.index, r] as const));
      for (const d of deferred) {
        const row = rowByIndex.get(d.index);
        if (!row) continue;
        const candidates = membersByNameLower.get(d.name.trim().toLowerCase()) ?? [];
        if (candidates.length === 0) {
          row.resolution = { kind: "no_match" };
        } else if (candidates.length === 1) {
          const m = candidates[0];
          row.resolution =
            m.activeStatus === "Active"
              ? { kind: "ready", memberId: m.id, name: m.name, attended: d.attended, hours: d.hours }
              : { kind: "inactive_member", memberId: m.id, name: m.name, attended: d.attended, hours: d.hours };
        } else {
          row.resolution = {
            kind: "ambiguous",
            candidates: candidates.map(memberCandidate),
            attended: d.attended,
            hours: d.hours,
          };
        }
      }
      return rows;
    };

    const status = (row: AttRow): RowStatus => {
      switch (row.resolution.kind) {
        case "ready":
          return "ready";
        case "skipped":
          return "skipped";
        default:
          return "conflict";
      }
    };

    const apply = async (readyRows: AttRow[], user: string) => {
      const bulk: BulkAttendanceRow[] = readyRows.flatMap((r) =>
        r.resolution.kind === "ready"
          ? [{
              memberId: r.resolution.memberId,
              name: r.resolution.name,
              attended: r.resolution.attended,
              ...(r.resolution.hours != null ? { hours: r.resolution.hours } : {}),
            }]
          : []
      );
      await bulkSetAttendance({ eventId: event.id, rows: bulk, user });
      return { appliedCount: bulk.length };
    };

    const renderRow = (row: AttRow, api: RowApi<AttRow>) => (
      <AttendanceRowItem row={row} api={api} />
    );

    return {
      title: "Bulk Attendance Upload",
      description:
        "Upload a CSV to mark attendance in bulk. Rows are matched by email, then name; unmatched rows are flagged for you to resolve before applying.",
      templateFilename: "attendance-template.csv",
      templateCsv: TEMPLATE_CSV,
      columnsHint: "Columns: Name, Email, Attended, Hours (Hours optional)",
      prepare,
      analyze,
      status,
      renderRow,
      apply,
    };
  }, [event.id]);
}

// ---------- Row UI ----------

function AttendanceRowItem({ row, api }: { row: AttRow; api: RowApi<AttRow> }) {
  const res = row.resolution;
  const skip = () => api.updateRow(row.key, { resolution: { kind: "skipped" } });

  if (res.kind === "ready") {
    return (
      <div className="p-3 flex items-start gap-3">
        <Check className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm">
            <span className="font-medium">{res.name}</span>
            <span className="mx-1.5 text-muted-foreground">·</span>
            <span className="text-muted-foreground">
              {res.attended ? "attended" : "not attended"}
            </span>
            {res.hours != null && (
              <>
                <span className="mx-1.5 text-muted-foreground">·</span>
                <span className="text-muted-foreground">{res.hours}h</span>
              </>
            )}
          </p>
        </div>
        <Button variant="ghost" size="sm" className="h-7" onClick={skip}>
          Skip
        </Button>
      </div>
    );
  }

  if (res.kind === "skipped") {
    return (
      <div className="p-3 flex items-center gap-3 opacity-50">
        <X className="h-4 w-4 text-muted-foreground shrink-0" />
        <p className="text-sm flex-1 min-w-0 truncate">
          Row {row.index}: <span className="line-through">{row.rawName || row.rawEmail}</span>
        </p>
      </div>
    );
  }

  if (res.kind === "bad_attended") {
    return (
      <ConflictShell row={row} onSkip={skip} note={`Couldn't interpret "${res.raw}" as yes/no.`} />
    );
  }

  if (res.kind === "no_match") {
    return (
      <ConflictShell
        row={row}
        onSkip={skip}
        note="No attendee or member matches this email or name."
      />
    );
  }

  if (res.kind === "invalid") {
    return <ConflictShell row={row} onSkip={skip} note={res.reason} />;
  }

  if (res.kind === "inactive_member") {
    return (
      <div className="p-3 flex items-start gap-3 bg-amber-50/40 dark:bg-amber-950/10">
        <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0 space-y-2">
          <div>
            <p className="text-sm font-medium">{res.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              This member is Lapsed. Add them anyway?
            </p>
          </div>
          <Button
            size="sm"
            onClick={() =>
              api.updateRow(row.key, {
                resolution: {
                  kind: "ready",
                  memberId: res.memberId,
                  name: res.name,
                  attended: res.attended,
                  hours: res.hours,
                },
              })
            }
          >
            Add anyway
          </Button>
        </div>
        <Button variant="ghost" size="sm" className="h-7" onClick={skip}>
          Skip
        </Button>
      </div>
    );
  }

  if (res.kind === "ambiguous") {
    return (
      <div className="p-3 flex items-start gap-3 bg-amber-50/40 dark:bg-amber-950/10">
        <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0 space-y-2">
          <div>
            <p className="text-sm font-medium">{row.rawName || row.rawEmail}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Multiple people match. Pick the right one.
            </p>
          </div>
          <Select
            value={res.pickedId ?? ""}
            onValueChange={(memberId) => {
              const picked = res.candidates.find((c) => c.memberId === memberId);
              api.updateRow(row.key, {
                resolution: {
                  kind: "ready",
                  memberId,
                  name: picked?.label.split(" · ")[0] ?? row.rawName,
                  attended: res.attended,
                  hours: res.hours,
                },
              });
            }}
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="Pick a person..." />
            </SelectTrigger>
            <SelectContent>
              {res.candidates.map((c) => (
                <SelectItem key={c.memberId} value={c.memberId}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="ghost" size="sm" className="h-7" onClick={skip}>
          Skip
        </Button>
      </div>
    );
  }

  return null;
}

function ConflictShell({
  row,
  note,
  onSkip,
}: {
  row: AttRow;
  note: string;
  onSkip: () => void;
}) {
  return (
    <div className="p-3 flex items-start gap-3 bg-amber-50/40 dark:bg-amber-950/10">
      <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm">
          Row {row.index}: <span className="font-medium">{row.rawName || row.rawEmail}</span>
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">{note}</p>
      </div>
      <Button variant="ghost" size="sm" className="h-7" onClick={onSkip}>
        Skip
      </Button>
    </div>
  );
}

// ---------- Public dialog ----------

export function BulkAttendanceCsvDialog({
  open,
  onOpenChange,
  event,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: AppEvent & { id: string };
  onApplied?: () => void;
}) {
  const adapter = useAttendanceAdapter(event);
  return (
    <BulkUploadDialog
      open={open}
      onOpenChange={onOpenChange}
      adapter={adapter}
      onApplied={onApplied}
    />
  );
}
